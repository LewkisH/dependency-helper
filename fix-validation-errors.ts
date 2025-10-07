
// Type definitions

import { RJSFSchema } from "@rjsf/utils";

export interface ValidationError {
  property: string;
  message: string;
  params?: any;
  stack?: string;
  schemaPath?: string;
}

export interface MappedError {
  fieldPath: string;
  message: string;
  originalError: ValidationError;
}


interface FormData {
  [key: string]: any;
}

interface SchemaProperty {
  type?: string;
  enum?: any[];
  title?: string;
  properties?: Record<string, SchemaProperty>;
  dependencies?: Record<string, DependencyRule>;
  required?: string[];
  items?: SchemaProperty;
}

interface DependencyRule {
  oneOf?: Array<{
    properties?: Record<string, SchemaProperty>;
    required?: string[];
  }>;
}

interface Schema {
  properties: Record<string, SchemaProperty>;
}

interface Suggestion {
  field: string;
  currentValue: string;
  allowedValues: any[];
  isRequired: boolean;
  title?: string;
}

interface AnalysisResult {
  triggerField?: string;
  triggerValue?: any;
  errorField: string;
  currentValue: any;
  suggestions: Suggestion[];
}

// Helper function to check if a field path exists in the schema
const fieldExistsInSchema = (fieldPath: string, ffSchema: RJSFSchema): boolean => {
  const pathParts = fieldPath.split('.');
  let currentSchema: any = ffSchema;

  for (const part of pathParts) {
    // Handle array indices (numeric parts)
    if (!isNaN(Number(part))) {
      // For array indices, we need to check if the current schema is an array type
      if (currentSchema?.type === 'array' && currentSchema?.items) {
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
};

/**
 * Get nested property value from an object using dot notation
 * Handles array indices properly
 */
function getNestedValue(obj: any, pathString: string): any {
  const keys = pathString.replace(/^\./, '').split('.');
  return keys.reduce((current: any, key: string) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Handle array indices
    if (!isNaN(Number(key))) {
      return Array.isArray(current) ? current[parseInt(key)] : undefined;
    }

    return typeof current === 'object' ? current[key] : undefined;
  }, obj);
}

/**
 * Parse the schema path to find parent object path
 */
function getParentPath(fieldPath: string): string | null {
  const parts = fieldPath.split('.');
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join('.');
}

/**
 * Find the dependency field that triggered the error
 */
function findDependencyField(schemaPath: string): string | null {
  // Extract dependency field from schema path like:
  // "#/properties/customer/dependencies/lro/oneOf/1/properties/lro/enum"
  const match = schemaPath.match(/\/dependencies\/([^\/]+)\//);
  return match ? match[1] : null;
}

/**
 * Get the schema object for a given parent path
 * Handles nested paths like objects.insuredItem.0.products.bpp
 */
function getSchemaForPath(schema: Schema, parentPath: string | null): any {
  if (!parentPath) return schema.properties;

  const parts = parentPath.split('.');
  let currentSchema: any = schema.properties;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isNumeric = !isNaN(Number(part));

    if (isNumeric) {
      // This is an array index - navigate into items if this is an array schema
      if (currentSchema.type === 'array' && currentSchema.items) {
        currentSchema = currentSchema.items;
      }
      // After navigating into items, the next access will need properties
      continue;
    }

    // For non-numeric parts, we need to navigate into properties first if this is an object
    if (currentSchema.type === 'object' && currentSchema.properties) {
      currentSchema = currentSchema.properties;
    }

    // Now access the property
    if (currentSchema[part]) {
      currentSchema = currentSchema[part];
    } else {
      return null; // Path not found
    }
  }

  return currentSchema;
}

/**
 * Check nested required fields in a schema property (like data, financials, etc.)
 */
function checkNestedRequiredFields(
  ffSchema: RJSFSchema,
  propName: string,
  propSchema: SchemaProperty,
  propPath: string,
  propValue: any,
  suggestions: Suggestion[],
): void {
  // If this property is an object with required fields
  if (propSchema.type === 'object' && propSchema.properties) {
    const nestedRequired = propSchema.required || [];
    const nestedData = propValue || {};

    for (const [nestedFieldName, nestedFieldSchema] of Object.entries(propSchema.properties)) {
      const nestedFieldPath = `${propPath}.${nestedFieldName}`;
      const nestedFieldValue = nestedData[nestedFieldName];

      // Check if this nested field is required but missing or invalid
      const isRequired = nestedRequired.includes(nestedFieldName);

      if (nestedFieldSchema.enum) {
        const isValid = nestedFieldSchema.enum.includes(nestedFieldValue);
        if ((!isValid || nestedFieldValue === undefined) && isRequired) {
          if (fieldExistsInSchema(nestedFieldPath, ffSchema as RJSFSchema)) {
            suggestions.push({
              field: nestedFieldPath,
              currentValue: nestedFieldValue !== undefined ? nestedFieldValue : '<not set>',
              allowedValues: nestedFieldSchema.enum,
              isRequired: true,
              title: nestedFieldSchema.title
            });

          }
        }
      } else if (isRequired && nestedFieldValue === undefined) {
        let allowedValues: any[] = ['<value required>'];
        if (nestedFieldSchema.type === 'number') allowedValues = ['<a number>'];
        else if (nestedFieldSchema.type === 'string') allowedValues = ['<a string>'];
        else if (nestedFieldSchema.type === 'array') allowedValues = ['<an array>'];
        if (fieldExistsInSchema(nestedFieldPath, ffSchema as RJSFSchema)) {
          suggestions.push({
            field: nestedFieldPath,
            currentValue: '<not set>',
            allowedValues,
            isRequired: true,
            title: nestedFieldSchema.title
          });
        }
      }

      // Check array minItems/maxItems constraints
      if (nestedFieldSchema.type === 'array' && Array.isArray(nestedFieldValue)) {
        const minItems = (nestedFieldSchema as any).minItems;
        const maxItems = (nestedFieldSchema as any).maxItems;

        if (minItems && nestedFieldValue.length < minItems) {
          if (fieldExistsInSchema(nestedFieldPath, ffSchema as RJSFSchema)) {
            suggestions.push({
              field: nestedFieldPath,
              currentValue: `array with ${nestedFieldValue.length} items`,
              allowedValues: [`at least ${minItems} items`],
              isRequired: true,
              title: nestedFieldSchema.title
            });
          }
        }

        if (maxItems && nestedFieldValue.length > maxItems) {
          if (fieldExistsInSchema(nestedFieldPath, ffSchema as RJSFSchema)) {
            suggestions.push({
              field: nestedFieldPath,
              currentValue: `array with ${nestedFieldValue.length} items`,
              allowedValues: [`at most ${maxItems} items`],
              isRequired: true,
              title: nestedFieldSchema.title
            });
          }
        }

        // Check if array items have required fields
        if (nestedFieldSchema.items && typeof nestedFieldSchema.items === 'object') {
          const itemSchema = nestedFieldSchema.items;
          const itemRequired = itemSchema.required || [];

          // Check each item in the array
          nestedFieldValue.forEach((item: any, index: number) => {
            if (itemSchema.properties) {
              for (const [itemFieldName, itemFieldSchema] of Object.entries(itemSchema.properties)) {
                const itemFieldPath = `${nestedFieldPath}[${index}].${itemFieldName}`;
                const itemFieldValue = item?.[itemFieldName];
                const isItemFieldRequired = itemRequired.includes(itemFieldName);

                // Check if required field is missing
                if (isItemFieldRequired && (itemFieldValue === undefined || itemFieldValue === null || itemFieldValue === '')) {
                  let allowedValues: any[] = ['(value required)'];
                  if (itemFieldSchema.type === 'number') allowedValues = ['(a number)'];
                  else if (itemFieldSchema.type === 'string') allowedValues = ['(a string)'];
                  else if (itemFieldSchema.type === 'boolean') allowedValues = ['true or false'];

                  if (fieldExistsInSchema(itemFieldPath, ffSchema as RJSFSchema)) {
                    suggestions.push({
                      field: itemFieldPath,
                      currentValue: formatValue(itemFieldValue),
                      allowedValues,
                      isRequired: true,
                      title: itemFieldSchema.title
                    });
                  }
                }
              }
            }
          });
        }
      }
    }
  }
}

/**
 * Find all cascading dependencies for a given object and its current values
 * This recursively explores all dependency chains
 */
function findAllRequiredFields(ffSchema: RJSFSchema, parentSchema: any, parentData: any, parentPath: string | null, visited: Set<string> = new Set()): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (!parentSchema) {
    return suggestions;
  }

  // Check if this schema has dependencies
  if (!parentSchema.dependencies) {
    return suggestions;
  }

  // Iterate through all dependencies defined in the schema
  for (const [depFieldName, depRule] of Object.entries(parentSchema.dependencies) as [string, any][]) {
    const depValue = parentData?.[depFieldName];

    // Skip if we don't have a value for this dependency trigger
    if (depValue === undefined) continue;

    // Create a unique key to avoid infinite loops
    const visitKey = `${parentPath || 'root'}.${depFieldName}:${JSON.stringify(depValue)}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    // Check if this dependency has oneOf schemas
    if (depRule.oneOf) {
      // Find the matching oneOf schema for the current dependency value
      const matchingSchema = depRule.oneOf.find((s: any) => {
        const enumValues = s.properties?.[depFieldName]?.enum;
        return enumValues && enumValues.includes(depValue);
      });

      if (matchingSchema) {
        const topLevelRequired = matchingSchema.required || [];

        // Check all properties in the matching schema
        for (const [propName, propSchema] of Object.entries(matchingSchema.properties || {}) as [string, any][]) {
          if (propName === depFieldName) continue; // Skip the trigger field itself

          const propPath = parentPath ? `${parentPath}.${propName}` : propName;
          const propValue = parentData?.[propName];

          // Check if property has enum constraints
          if (propSchema.enum) {
            const isValid = propSchema.enum.includes(propValue);
            if (!isValid || propValue === undefined) {
              if (fieldExistsInSchema(propPath, ffSchema as RJSFSchema)) {
                suggestions.push({
                  field: propPath,
                  currentValue: propValue !== undefined ? propValue : '<not set>',
                  allowedValues: propSchema.enum,
                  isRequired: topLevelRequired.includes(propName),
                  title: propSchema.title || propName
                });
              }
            }
          }
          // Check if this is a nested object (like 'data' or 'financials')
          else if (propSchema.type === 'object') {
            checkNestedRequiredFields(ffSchema, propName, propSchema, propPath, propValue, suggestions);
          }
          // Check if property is required but missing (and doesn't have enum or object)
          else if (topLevelRequired.includes(propName) && propValue === undefined) {
            const allowedValues = propSchema.enum ||
              (propSchema.type === 'number' ? ['<a number>'] :
                propSchema.type === 'array' ? ['<an array>'] :
                  propSchema.type === 'string' ? ['<a string>'] :
                    ['<value required>']);

            if (fieldExistsInSchema(propPath, ffSchema as RJSFSchema)) {
              suggestions.push({
                field: propPath,
                currentValue: '<not set>',
                allowedValues: allowedValues,
                isRequired: true,
                title: propSchema.title || propName

              });
            }
          }
        }

        // Now recursively check if any of the current values trigger more dependencies
        // For example, if classSegment is set, check if there's a dependency on classSegment
        for (const [propName, propValue] of Object.entries(parentData || {}) as [string, any][]) {
          if (propValue !== undefined && parentSchema.dependencies?.[propName] && propName !== depFieldName) {
            const nestedSuggestions = findAllRequiredFields(
              ffSchema,
              parentSchema,
              parentData,
              parentPath,
              visited
            );
            suggestions.push(...nestedSuggestions);
          }
        }
      }
    }
  }

  return suggestions;
}

/**
 * Analyze dependency-based errors with full cascade support
 */
function analyzeDependencyError(
  error: MappedError,
  formData: FormData,
  schema: Schema,
  ffSchema: RJSFSchema
): AnalysisResult | null {
  const fieldPath = error.fieldPath;
  const schemaPath = error.originalError.schemaPath || "";

  // Get current value in form
  const currentValue = getNestedValue(formData, fieldPath);

  // Special handling for fields that are INSIDE a dependency's required fields
  // e.g., "objects.insuredItem.0.products.bpp.financials.insurers" with minItems error
  // This means we need to look at the parent dependency (include) to understand the context
  if (schemaPath.includes("/minItems") || schemaPath.includes("/maxItems")) {
    // This field is failing a constraint. Let's find if it's part of a dependency requirement
    // Look for a parent that might have a dependency (e.g., bpp has dependency on "include")
    const pathParts = fieldPath.split(".");

    // Try to find a parent that has dependencies
    for (let i = pathParts.length - 1; i >= 0; i--) {
      const testPath = pathParts.slice(0, i).join(".");
      const testSchema = getSchemaForPath(schema, testPath);

      if (testSchema?.dependencies) {
        // Found a parent with dependencies!
        const parentData = testPath ? getNestedValue(formData, testPath) : formData;

        // Check each dependency to see if it has required fields
        for (const [depKey, depRules] of Object.entries(testSchema.dependencies)) {
          const triggerValue = parentData?.[depKey];
          const typedDepRules = depRules as DependencyRule;

          if (typedDepRules.oneOf) {
            // Find the matching oneOf branch based on current trigger value
            for (const branch of typedDepRules.oneOf) {
              // Check if this branch matches the current trigger value
              const branchDepValue = branch.properties?.[depKey];

              if (branchDepValue?.enum && branchDepValue.enum.includes(triggerValue)) {
                // This is the active branch! Check what it requires
                const suggestions: Suggestion[] = [];

                // Add the constraint from this specific field
                const limit = error.originalError.params?.limit;
                if (limit !== undefined) {
                  if (fieldExistsInSchema(fieldPath, ffSchema as RJSFSchema)) {
                    suggestions.push({
                      field: fieldPath,
                      currentValue: formatValue(currentValue),
                      allowedValues: [`at least ${limit} items`],
                      isRequired: true,
                      title: error.originalError.stack?.split("'")[1] || undefined,
                    });
                  }
                }

                // Also check for other required fields in this branch that might be missing
                if (branch.properties) {
                  for (const [propName, propSchema] of Object.entries(branch.properties)) {
                    if (propName === depKey) continue; // Skip the dependency trigger itself

                    const propPath = testPath ? `${testPath}.${propName}` : propName;
                    const propValue = parentData?.[propName];

                    // Check nested required fields in this property
                    checkNestedRequiredFields(ffSchema, propName, propSchema, propPath, propValue, suggestions);
                  }
                }

                if (suggestions.length > 0) {
                  return {
                    triggerField: testPath ? `${testPath}.${depKey}` : depKey,
                    triggerValue: triggerValue,
                    errorField: fieldPath,
                    currentValue: currentValue,
                    suggestions: suggestions,
                  };
                }
              }
            }
          }
        }
      }
    }
  }

  // Find the dependency field from the schema path
  const dependencyField = findDependencyField(schemaPath);

  if (dependencyField) {
    const parentPath = getParentPath(fieldPath);
    const parentData = parentPath ? getNestedValue(formData, parentPath) : formData;

    // Get the dependency trigger value - read it from the actual form data
    const triggerValue = parentData ? parentData[dependencyField] : undefined;

    // Get the schema for the PARENT object that contains the dependency
    const parentSchema = getSchemaForPath(schema, parentPath);

    // Check if parentSchema has the dependency definition
    if (!parentSchema?.dependencies?.[dependencyField]) {
      // If not, we might need to look at properties level
      if (parentSchema?.properties && parentSchema.properties[dependencyField]) {
        // This is a product-level schema, look for dependencies
        const productSchema = parentSchema.properties[dependencyField];
        if (productSchema?.dependencies) {
          // Use this schema for dependency analysis
          const allSuggestions = findAllRequiredFields(
            ffSchema,
            productSchema,
            parentData?.[dependencyField],
            parentPath ? `${parentPath}.${dependencyField}` : dependencyField
          );

          if (allSuggestions.length > 0) {
            return {
              triggerField: parentPath ? `${parentPath}.${dependencyField}` : dependencyField,
              triggerValue: triggerValue,
              errorField: fieldPath,
              currentValue: currentValue,
              suggestions: allSuggestions,
            };
          }
        }
      }
    } else {
      // Find ALL required fields by exploring the full dependency chain
      const allSuggestions = findAllRequiredFields(ffSchema, parentSchema, parentData, parentPath);
      console.log("triggerValue", parentPath, dependencyField);
      if (allSuggestions.length > 0) {
        return {
          triggerField: parentPath ? `${parentPath}.${dependencyField}` : dependencyField,
          triggerValue: triggerValue,
          errorField: fieldPath,
          currentValue: currentValue,
          suggestions: allSuggestions,
        };
      }
    }
  }

  // Handle simple enum errors
  if (error.originalError.params?.allowedValues) {
    return {
      errorField: fieldPath,
      currentValue: currentValue !== undefined ? currentValue : "<not set>",
      suggestions: [
        {
          field: fieldPath,
          currentValue: currentValue !== undefined ? currentValue : "<not set>",
          allowedValues: error.originalError.params.allowedValues,
          isRequired: true,
        },
      ],
    };
  }

  // Handle minItems errors
  if (error.originalError.params?.limit && error.message.includes("fewer than")) {
    const currentLength = Array.isArray(currentValue) ? currentValue.length : 0;
    return {
      errorField: fieldPath,
      currentValue: `array with ${currentLength} items`,
      suggestions: [
        {
          field: fieldPath,
          currentValue: `array with ${currentLength} items`,
          allowedValues: [`at least ${error.originalError.params.limit} items`],
          isRequired: true,
        },
      ],
    };
  }

  return null;
}

/**
 * Format value for display
 */
function formatValue(value: any): string {
  if (value === null) return "null";
  if (value === "") return "<empty string>";
  if (value === undefined) return "<not set>";
  if (value === false) return "false";
  if (value === true) return "true";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * Get human-readable label for a field from flattened schema
 * Falls back to field path if no title is found
 */
function getFieldLabel(fieldPath: string, ffSchema: RJSFSchema): string | undefined {
  if (!fieldPath) return undefined;
  
  const pathParts = fieldPath.split('.');
  let currentSchema: any = ffSchema;

  for (const part of pathParts) {
    // Handle array indices (numeric parts)
    if (!isNaN(Number(part))) {
      // For array indices, we need to check if the current schema is an array type
      if (currentSchema?.type === 'array' && currentSchema?.items) {
        currentSchema = currentSchema.items;
      } else {
        return fieldPath; // Fallback to path if navigation fails
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
      return fieldPath; // Fallback to path if property not found
    }
  }

  // Return the title if it exists, otherwise fallback to the field path
  return currentSchema?.title || fieldPath;
}

export interface GroupedAnalysisResult {
  triggerField?: string;
  triggerValue?: any;
  triggerFieldLabel?: string;
  errorField: string;
  errorFieldLabel?: string;
  suggestions: Suggestion[];
  type: "dependency" | "simple";
}

/**
 * Main function to analyze all errors
 * @param validationErrors - Array of mapped validation errors from mapValidationErrors
 * @param formData - The form data object containing manualPayload
 * @param schema - The JSON schema used for validation
 * @returns Array of grouped analysis results
 */
export function analyzeValidationErrors(
  validationErrors: MappedError[],
  formData: FormData,
  ffSchema: RJSFSchema,
  schema: Schema
): GroupedAnalysisResult[] {
  const analyzed = new Set();
  const results = [];

  // Analyze each validation error
  for (const error of validationErrors) {
    const fieldPath = error.fieldPath;

    // Skip if we've already analyzed this field
    if (analyzed.has(fieldPath)) continue;

    const analysis = analyzeDependencyError(error, formData, schema, ffSchema);
    // console.log({error, analysis});

    if (analysis) {
      results.push(analysis);
      analyzed.add(fieldPath);

      // Also mark related errors as analyzed
      if (analysis.triggerField) {
        analyzed.add(analysis.triggerField);
        const parentPath = getParentPath(fieldPath);
        if (parentPath) analyzed.add(parentPath);
      }
    }
  }

  // Display results grouped by trigger field
  const grouped: Record<string, AnalysisResult[]> = {};

  for (const result of results) {
    const key = result.triggerField || result.errorField;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(result);
  }

  const groupedResults: GroupedAnalysisResult[] = [];

  // Display each group and build return array
  for (const [_, analyses] of Object.entries(grouped)) {
    const firstAnalysis = analyses[0];

    if (firstAnalysis.triggerField && firstAnalysis.triggerValue !== undefined) {
      // Collect all unique suggestions
      const allSuggestions = [];
      const seenFields = new Set();

      for (const analysis of analyses) {
        for (const suggestion of analysis.suggestions) {
          if (!seenFields.has(suggestion.field)) {
            allSuggestions.push(suggestion);
            seenFields.add(suggestion.field);
          }
        }
      }

      allSuggestions.forEach((suggestion, index) => {
        const fieldLabel = suggestion.title || suggestion.field;
        console.log("fieldLabel", fieldLabel);
      });

      // Add to return array
      groupedResults.push({
        triggerField: firstAnalysis.triggerField,
        triggerValue: firstAnalysis.triggerValue,
        triggerFieldLabel: getFieldLabel(firstAnalysis.triggerField!, ffSchema),
        errorField: firstAnalysis.errorField,
        errorFieldLabel: getFieldLabel(firstAnalysis.errorField, ffSchema),
        suggestions: allSuggestions,
        type: "dependency",
      });
    } else {
      // Add to return array
      groupedResults.push({
        errorField: firstAnalysis.errorField,
        errorFieldLabel: getFieldLabel(firstAnalysis.errorField, ffSchema),
        suggestions: firstAnalysis.suggestions,
        type: "simple",
      });
    }
  }

  // Console.log the formatted text analysis
  // console.log("Validation error analysis:", output);
  console.log(groupedResults);
  return groupedResults;
}
