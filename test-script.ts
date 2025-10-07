import * as fs from 'fs';
import * as path from 'path';

// Import the main function and types
import { analyzeValidationErrors, ValidationError, MappedError } from './fix-validation-errors';

function runTest() {
  console.log('🔍 Starting validation error analysis...\n');
  
  try {
    console.log("📂 Loading data files...");
    // Load the data files
    const validationErrorsFile = JSON.parse(
      fs.readFileSync(path.join(__dirname, "validation-errors.json"), "utf-8")
    );
    const validationErrors: MappedError[] =
      validationErrorsFile.mappedErrors || validationErrorsFile;
    console.log(`   ✓ Loaded ${validationErrors.length} validation errors`);

    const formDataFile = JSON.parse(
      fs.readFileSync(path.join(__dirname, "form-data.json"), "utf-8")
    );
    const formData: Record<string, any> = formDataFile.formData || formDataFile;

    console.log("   ✓ Loaded form data");

    const ffSchemaFile = JSON.parse(
      fs.readFileSync(path.join(__dirname, "flattened-schema.json"), "utf-8")
    );
    const ffSchema: Record<string, any> = ffSchemaFile.schema || ffSchemaFile;
    console.log("   ✓ Loaded flattened schema");

    const vendorSchemaFile = JSON.parse(
      fs.readFileSync(path.join(__dirname, "dc-schema.json"), "utf-8")
    );
    const vendorSchema: any = vendorSchemaFile.vendorSchema || vendorSchemaFile;
    console.log("   ✓ Loaded vendor schema\n");

    console.log("🔄 Running analysis...");
    // Run the analysis
    const result = analyzeValidationErrors(
      validationErrors,
      formData,
      ffSchema,
      vendorSchema
    );

    console.log("\n📊 Results:");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n✅ Analysis complete!");
  } catch (error) {
    console.error('❌ Error during analysis:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

runTest();
