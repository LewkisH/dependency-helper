import { RJSFSchema } from "@rjsf/utils";
import { type GroupedAnalysisResult, type MappedError, type ValidationAnalysisOutput, type MissingFieldInfo } from "./fix-validation-errors";


/**
 * Check if a field path exists in the flattened schema
 */
function fieldExistsInSchema(
  fieldPath: string,
  ffSchema: RJSFSchema
): boolean {
  const pathParts = fieldPath.split(".");
  let currentSchema: any = ffSchema;

  for (const part of pathParts) {
    // Handle array indices (numeric parts)
    if (!isNaN(Number(part))) {
      if (currentSchema?.type === "array" && currentSchema?.items) {
        currentSchema = currentSchema.items;
      } else {
        return false;
      }
      continue;
    }

    // Navigate to properties if this is an object schema
    if (currentSchema?.properties) {
      currentSchema = currentSchema.properties;
    }

    // Check if the property exists
    if (currentSchema?.[part]) {
      currentSchema = currentSchema[part];
    } else {
      return false;
    }
  }

  return true;
}

/**
 * Main filtering function that processes both validation errors and analysis output.
 * Optimized for performance with Set-based lookups.
 * 
 * @param validationErrors - Raw RJSF validation errors (from validation-errors.json)
 * @param ffSchema - The flattened schema (UI schema)
 * @param analysisOutput - The output from analyzeValidationErrors
 * @returns Filtered validation errors and analysis output
 */
export function filterUnactionableErrors(
  validationErrors: MappedError[],
  ffSchema: RJSFSchema,
  analysisOutput: ValidationAnalysisOutput
): {
  filteredValidationErrors: MappedError[];
  filteredAnalysisOutput: ValidationAnalysisOutput;
} {
  // STEP 1: Build a Set of actionable error fields (O(1) lookups)
  const actionableErrorFields = new Set<string>();
  
  // Pre-check which analyses are actionable and collect their error fields
  for (const analysis of analysisOutput.analyses) {
    const { errorField, suggestions, type } = analysis;
    
    // Check if error field itself exists in the schema
    const errorFieldExists = fieldExistsInSchema(errorField, ffSchema);
    
    // Determine if this error is actionable
    let isActionable = false;
    
    if (type === "dependency") {
      // For dependency errors: actionable if error field exists AND at least one suggestion exists in UI
      // We need at least ONE suggestion the user can act on
      if (errorFieldExists) {
        const hasActionableSuggestion = suggestions.some((suggestion) =>
          fieldExistsInSchema(suggestion.field, ffSchema)
        );
        isActionable = hasActionableSuggestion;
      }
    } else if (type === "simple") {
      // For simple errors: actionable if error field exists AND has at least one suggestion
      // that exists in the UI schema
      if (errorFieldExists) {
        const hasActionableSuggestion = suggestions.some((suggestion) =>
          fieldExistsInSchema(suggestion.field, ffSchema)
        );
        isActionable = hasActionableSuggestion;
      }
    }
    
    if (isActionable) {
      actionableErrorFields.add(errorField);
    }
  }

  // STEP 2: Filter validation errors (O(n) with O(1) lookups)
  const filteredValidationErrors = validationErrors.filter((error) => {
    return actionableErrorFields.has(error.fieldPath);
  });

  // STEP 3: Filter and transform analysis output
  const filteredAnalyses: GroupedAnalysisResult[] = [];
  const filteredMissingFields: MissingFieldInfo[] = [];
  const seenMissingFieldKeys = new Set<string>();

  for (const analysis of analysisOutput.analyses) {
    const { errorField, suggestions, type } = analysis;

    // Only process if this error field is actionable
    if (!actionableErrorFields.has(errorField)) {
      continue;
    }

    // For both dependency and simple errors: filter to only suggestions that exist in ffSchema
    // Users can only act on fields they can actually see and edit in the UI
    const filteredSuggestions = suggestions.filter((suggestion) =>
      fieldExistsInSchema(suggestion.field, ffSchema)
    );

    // Skip if no actionable suggestions remain (shouldn't happen due to pre-check, but safety)
    if (filteredSuggestions.length === 0) {
      continue;
    }

    // Add to filtered analyses with filtered suggestions
    filteredAnalyses.push({
      ...analysis,
      suggestions: filteredSuggestions,
    });

    // Handle missing field info
    const missingInfo = analysisOutput.missingInFlattenedSchema.find(
      (info) => info.errorField === errorField
    );

    if (missingInfo) {
      // Filter to only include missing fields that were in the original suggestions
      const relevantMissingFields = missingInfo.missingFields.filter(
        (field) => suggestions.some((s) => s.field === field)
      );

      if (relevantMissingFields.length > 0) {
        // Create a unique key to avoid duplicates
        const key = `${errorField}:${relevantMissingFields.sort().join(",")}`;
        
        if (!seenMissingFieldKeys.has(key)) {
          seenMissingFieldKeys.add(key);
          filteredMissingFields.push({
            errorField: missingInfo.errorField,
            missingFields: relevantMissingFields,
          });
        }
      }
    }
  }

  return {
    filteredValidationErrors,
    filteredAnalysisOutput: {
      analyses: filteredAnalyses,
      missingInFlattenedSchema: filteredMissingFields,
    },
  };
}

/**
 * Enhanced version that also deduplicates analyses with identical suggestions.
 * Slightly slower due to additional deduplication step.
 * 
 * @param validationErrors - Raw RJSF validation errors
 * @param ffSchema - The flattened schema (UI schema)
 * @param analysisOutput - The output from analyzeValidationErrors
 * @returns Filtered, deduplicated validation errors and analysis output
 */
export function filterAndDeduplicateErrors(
  validationErrors: MappedError[],
  ffSchema: RJSFSchema,
  analysisOutput: ValidationAnalysisOutput
): {
  filteredValidationErrors: MappedError[];
  filteredAnalysisOutput: ValidationAnalysisOutput;
} {
  // First apply basic filtering
  const { filteredValidationErrors, filteredAnalysisOutput } =
    filterUnactionableErrors(validationErrors, ffSchema, analysisOutput);

  // Deduplicate analyses based on suggestion content
  const seenSuggestionKeys = new Map<string, GroupedAnalysisResult>();
  const deduplicated: GroupedAnalysisResult[] = [];
  const errorFieldsToKeep = new Set<string>();

  for (const analysis of filteredAnalysisOutput.analyses) {
    // Create a key based on sorted suggestion fields
    const suggestionKey = analysis.suggestions
      .map((s) => s.field)
      .sort()
      .join("|");

    if (!seenSuggestionKeys.has(suggestionKey)) {
      seenSuggestionKeys.set(suggestionKey, analysis);
      deduplicated.push(analysis);
      errorFieldsToKeep.add(analysis.errorField);
    }
    // Skip duplicates but track all error fields that map to this suggestion set
    else {
      errorFieldsToKeep.add(analysis.errorField);
    }
  }

  // Deduplicate missing field info
  const seenMissingKeys = new Set<string>();
  const deduplicatedMissing: MissingFieldInfo[] = [];

  for (const info of filteredAnalysisOutput.missingInFlattenedSchema) {
    const key = info.missingFields.sort().join("|");
    if (!seenMissingKeys.has(key)) {
      seenMissingKeys.add(key);
      deduplicatedMissing.push(info);
    }
  }

  // Filter validation errors to match deduplicated analyses
  const deduplicatedValidationErrors = filteredValidationErrors.filter(
    (error) => errorFieldsToKeep.has(error.fieldPath)
  );

  console.log("output", { deduplicatedValidationErrors, deduplicated, deduplicatedMissing });

  return {
    filteredValidationErrors: deduplicatedValidationErrors,
    filteredAnalysisOutput: {
      analyses: deduplicated,
      missingInFlattenedSchema: deduplicatedMissing,
    },
  };
}

/**
 * USAGE EXAMPLES:
 * 
 * ```typescript
 * import { analyzeValidationErrors } from './fix-validation-errors';
 * import { filterUnactionableErrors, filterAndDeduplicateErrors } from './filterOutUselessError';
 * 
 * // Step 1: Analyze validation errors
 * const analysisOutput = analyzeValidationErrors(
 *   validationErrors,
 *   formData,
 *   ffSchema,
 *   vendorSchema
 * );
 * 
 * // Step 2: Filter out unactionable errors (FAST - O(n))
 * const { filteredValidationErrors, filteredAnalysisOutput } = 
 *   filterUnactionableErrors(validationErrors, ffSchema, analysisOutput);
 * 
 * // OR for deduplicated output (slower but cleaner)
 * const { filteredValidationErrors, filteredAnalysisOutput } = 
 *   filterAndDeduplicateErrors(validationErrors, ffSchema, analysisOutput);
 * 
 * // Now use the filtered results
 * console.log('Actionable errors:', filteredValidationErrors);
 * console.log('Filtered analysis:', filteredAnalysisOutput);
 * ```
 * 
 * PERFORMANCE:
 * - filterUnactionableErrors: O(n + m) where n = validation errors, m = analyses
 *   Uses Set-based lookups for O(1) field existence checks
 * 
 * - filterAndDeduplicateErrors: O(n + m log m) due to sorting for deduplication
 *   Slightly slower but produces cleaner output
 * 
 * EXAMPLE SCENARIO (Case 2 - classSegment/classDescription):
 * 
 * Input:
 *   - 50 validation errors (including classSegment, classDescription errors)
 *   - Analysis shows 6 analyses with suggestions
 *   - Some suggestions point to missing fields: performSurgeries, nondiagnosticalProcedures, isHomeBasedBusiness
 *   - Some error fields exist in ffSchema: classSegment, classDescription
 *   - Some error fields are missing from ffSchema: securityFeatures.0
 * 
 * After filterUnactionableErrors():
 *   - Removes errors where ALL suggestions are missing from ffSchema
 *   - Example: classSegment error is REMOVED if performSurgeries, etc. don't exist in UI
 *   - Keeps errors where at least ONE suggestion exists in ffSchema
 *   - Suggestions: Filtered to ONLY include fields that exist in ffSchema
 *   - Result: Only shows errors the user can actually fix
 * 
 * After filterAndDeduplicateErrors():
 *   - Same filtering as above, plus merges duplicate analyses
 *   - If classSegment and classDescription suggest the same fields, keep only one
 */
