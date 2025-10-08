import * as fs from 'fs';
import * as path from 'path';
import { RJSFSchema } from '@rjsf/utils';
import { analyzeValidationErrors } from './fix-validation-errors';
import { 
  filterUnactionableErrors, 
  filterAndDeduplicateErrors 
} from './filterOutUselessError';

// Get test case directory from command line args (default to case2)
const args = process.argv.slice(2);
const testCaseDir = args[0] || 'case2';

console.log(`\n${'='.repeat(80)}`);
console.log(`Testing Filter Functions with ${testCaseDir}`);
console.log(`${'='.repeat(80)}\n`);

// Check if directory exists
const dirPath = path.join(__dirname, testCaseDir);
if (!fs.existsSync(dirPath)) {
  console.error(`Error: Directory ${testCaseDir} does not exist`);
  process.exit(1);
}

// Load validation errors
const validationErrorsPath = path.join(__dirname, testCaseDir, 'validation-errors.json');
const validationErrorsData = JSON.parse(fs.readFileSync(validationErrorsPath, 'utf-8'));
const validationErrors = validationErrorsData.mappedErrors || validationErrorsData;

// Load form data
const formDataPath = path.join(__dirname, testCaseDir, 'form-data.json');
const formDataFile = JSON.parse(fs.readFileSync(formDataPath, 'utf-8'));
const formData = formDataFile.formData || formDataFile;

// Load flattened schema
const flattenedSchemaPath = path.join(__dirname, testCaseDir, 'flattened-schema.json');
const flattenedSchemaFile = JSON.parse(fs.readFileSync(flattenedSchemaPath, 'utf-8'));
const ffSchema = (flattenedSchemaFile.schema || flattenedSchemaFile) as RJSFSchema;

// Load vendor schema
const vendorSchemaPath = path.join(__dirname, testCaseDir, 'vendor-schema.json');
const vendorSchemaFile = JSON.parse(fs.readFileSync(vendorSchemaPath, 'utf-8'));
const schema = vendorSchemaFile.vendorSchema || vendorSchemaFile;

console.log('📥 Input Statistics:');
console.log(`   - Validation Errors: ${validationErrors.length}`);
console.log(`   - Form Data Keys: ${Object.keys(formData).length}`);
console.log('');

// Step 1: Analyze validation errors
console.log('🔍 Step 1: Analyzing validation errors...\n');
const analysisOutput = analyzeValidationErrors(
  validationErrors,
  formData,
  ffSchema,
  schema
);

console.log('📊 Analysis Output:');
console.log(`   - Total Analyses: ${analysisOutput.analyses.length}`);
console.log(`   - Missing in Flattened Schema: ${analysisOutput.missingInFlattenedSchema.length}`);

// Show first 3 analyses with full details
console.log('\n   First 3 Analyses:');
analysisOutput.analyses.slice(0, 3).forEach((analysis, i) => {
  console.log(`   ${i + 1}. ${analysis.errorField} (type: ${analysis.type})`);
  console.log(`      - triggerField: ${analysis.triggerField || 'N/A'}`);
  console.log(`      - suggestions: ${analysis.suggestions.length}`);
});

if (analysisOutput.missingInFlattenedSchema.length > 0) {
  console.log('\n   Missing Fields:');
  analysisOutput.missingInFlattenedSchema.forEach(missing => {
    console.log(`     • Error Field: ${missing.errorField}`);
    console.log(`       Missing: ${missing.missingFields.join(', ')}`);
  });
}

// Count suggestions before filtering
const totalSuggestionsBefore = analysisOutput.analyses.reduce(
  (sum, analysis) => sum + analysis.suggestions.length, 
  0
);
console.log(`   - Total Suggestions: ${totalSuggestionsBefore}`);
console.log('');

// Step 2: Filter unactionable errors (FAST)
console.log('🚀 Step 2: Filtering unactionable errors (fast mode)...\n');
const startFast = Date.now();
const fastResult = filterUnactionableErrors(
  validationErrors,
  ffSchema,
  analysisOutput
);
const fastDuration = Date.now() - startFast;

console.log('✅ Fast Filter Results:');
console.log(`   - Filtered Validation Errors: ${fastResult.filteredValidationErrors.length} (removed ${validationErrors.length - fastResult.filteredValidationErrors.length})`);
console.log(`   - Filtered Analyses: ${fastResult.filteredAnalysisOutput.analyses.length} (removed ${analysisOutput.analyses.length - fastResult.filteredAnalysisOutput.analyses.length})`);
console.log(`   - Missing in Flattened Schema: ${fastResult.filteredAnalysisOutput.missingInFlattenedSchema.length}`);

const totalSuggestionsAfterFast = fastResult.filteredAnalysisOutput.analyses.reduce(
  (sum, analysis) => sum + analysis.suggestions.length, 
  0
);
console.log(`   - Total Suggestions: ${totalSuggestionsAfterFast} (removed ${totalSuggestionsBefore - totalSuggestionsAfterFast})`);
console.log(`   - Performance: ${fastDuration}ms`);
console.log('');

// Step 3: Filter and deduplicate (ENHANCED)
console.log('🔧 Step 3: Filtering with deduplication (enhanced mode)...\n');
const startDedup = Date.now();
const dedupResult = filterAndDeduplicateErrors(
  validationErrors,
  ffSchema,
  analysisOutput
);
const dedupDuration = Date.now() - startDedup;

console.log('✅ Dedup Filter Results:');
console.log(`   - Filtered Validation Errors: ${dedupResult.filteredValidationErrors.length} (removed ${validationErrors.length - dedupResult.filteredValidationErrors.length})`);
console.log(`   - Filtered Analyses: ${dedupResult.filteredAnalysisOutput.analyses.length} (removed ${analysisOutput.analyses.length - dedupResult.filteredAnalysisOutput.analyses.length})`);
console.log(`   - Missing in Flattened Schema: ${dedupResult.filteredAnalysisOutput.missingInFlattenedSchema.length}`);

const totalSuggestionsAfterDedup = dedupResult.filteredAnalysisOutput.analyses.reduce(
  (sum, analysis) => sum + analysis.suggestions.length, 
  0
);
console.log(`   - Total Suggestions: ${totalSuggestionsAfterDedup} (removed ${totalSuggestionsBefore - totalSuggestionsAfterDedup})`);
console.log(`   - Performance: ${dedupDuration}ms`);
console.log('');

// Comparison
console.log('📈 Comparison:');
console.log(`   - Fast vs Dedup: ${Math.abs(fastResult.filteredAnalysisOutput.analyses.length - dedupResult.filteredAnalysisOutput.analyses.length)} analyses difference`);
console.log(`   - Performance difference: ${Math.abs(fastDuration - dedupDuration)}ms`);
console.log('');

// Detailed output of fast filter results
console.log('\n' + '='.repeat(80));
console.log('DETAILED OUTPUT - Fast Filter Results');
console.log('='.repeat(80) + '\n');

console.log('📋 Filtered Validation Errors:');
if (fastResult.filteredValidationErrors.length === 0) {
  console.log('   (none - all errors were unactionable)');
} else {
  fastResult.filteredValidationErrors.slice(0, 5).forEach((error, index) => {
    console.log(`\n   ${index + 1}. Field: ${error.fieldPath}`);
    console.log(`      Message: ${error.message}`);
  });
  if (fastResult.filteredValidationErrors.length > 5) {
    console.log(`\n   ... and ${fastResult.filteredValidationErrors.length - 5} more errors`);
  }
}

console.log('\n\n📊 Filtered Analyses:');
if (fastResult.filteredAnalysisOutput.analyses.length === 0) {
  console.log('   (none - all analyses had no actionable suggestions)');
} else {
  fastResult.filteredAnalysisOutput.analyses.slice(0, 3).forEach((analysis, index) => {
    console.log(`\n   ${index + 1}. Error Field: ${analysis.errorField}`);
    if (analysis.errorFieldLabel) {
      console.log(`      Label: ${analysis.errorFieldLabel}`);
    }
    if (analysis.triggerField) {
      console.log(`      Trigger Field: ${analysis.triggerField}`);
      console.log(`      Trigger Value: ${JSON.stringify(analysis.triggerValue)}`);
    }
    console.log(`      Type: ${analysis.type}`);
    console.log(`      Suggestions (${analysis.suggestions.length}):`);
    analysis.suggestions.forEach(suggestion => {
      console.log(`         • ${suggestion.field} ${suggestion.title ? `(${suggestion.title})` : ''}`);
      console.log(`           Current: ${JSON.stringify(suggestion.currentValue)}`);
      console.log(`           Allowed: ${JSON.stringify(suggestion.allowedValues).slice(0, 100)}${JSON.stringify(suggestion.allowedValues).length > 100 ? '...' : ''}`);
    });
  });
  if (fastResult.filteredAnalysisOutput.analyses.length > 3) {
    console.log(`\n   ... and ${fastResult.filteredAnalysisOutput.analyses.length - 3} more analyses`);
  }
}

console.log('\n\n🔍 Missing in Flattened Schema:');
if (fastResult.filteredAnalysisOutput.missingInFlattenedSchema.length === 0) {
  console.log('   (none - all suggested fields exist in flattened schema)');
} else {
  fastResult.filteredAnalysisOutput.missingInFlattenedSchema.forEach(missing => {
    console.log(`\n   • Error Field: ${missing.errorField}`);
    console.log(`     Missing Fields: ${missing.missingFields.join(', ')}`);
  });
}

console.log('\n\n' + '='.repeat(80));
console.log('JSON OUTPUT - Fast Filter Results (for copying)');
console.log('='.repeat(80) + '\n');

console.log(JSON.stringify(fastResult, null, 2));

console.log('\n' + '='.repeat(80));
console.log('Test Complete!');
console.log('='.repeat(80) + '\n');
