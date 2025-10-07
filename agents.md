# Dependency Helper - Agent Documentation

## Project Overview

This project analyzes React JSON Schema Form (RJSF) validation errors to identify the root cause of validation failures and provide actionable suggestions for fixing them. The primary goal is to understand **why** a field has a validation error and **what changes** are needed to resolve it, particularly when dealing with complex schema dependencies.

## Problem Statement

When validating forms using JSON Schema, validation errors often occur due to complex dependency rules:
- Field A might require specific values in Field B
- Field B's allowed values depend on Field A's current value
- Nested dependencies can cascade through multiple fields
- Simple error messages don't explain the root cause or suggest fixes

## Core Functionality

### Main Entry Point: `analyzeValidationErrors()`

**Location:** `fix-validation-errors.ts`

**Function Signature:**
```typescript
function analyzeValidationErrors(
  validationErrors: MappedError[],
  formData: FormData,
  ffSchema: RJSFSchema,
  schema: Schema
): GroupedAnalysisResult[]
```

**Parameters:**
- `validationErrors`: Array of validation errors from RJSF (with `fieldPath`, `message`, `originalError`)
- `formData`: The actual form data being validated
- `ffSchema`: The flattened schema (used to verify field existence in UI)
- `schema`: The vendor/validation schema (contains dependency rules)

**Returns:**
Array of grouped analysis results showing the trigger field, current value, and suggested fixes.

### Output Format

```typescript
interface GroupedAnalysisResult {
  triggerField?: string;        // The field that triggered the dependency
  triggerValue?: any;           // Current value of the trigger field
  triggerFieldLabel?: string;   // Human-readable label for the trigger field (TODO: needs implementation)
  errorField: string;           // The field with the validation error
  errorFieldLabel?: string;     // Human-readable label for the error field (TODO: needs implementation)
  suggestions: Suggestion[];    // Array of fields to fix
  type: "dependency" | "simple" // Type of error
}

interface Suggestion {
  field: string;          // Path to the field (e.g., "customer.classDescription")
  currentValue: string;   // Current value of the field
  allowedValues: any[];   // Array of valid values
  isRequired: boolean;    // Whether this field is required
  title?: string;         // Human-readable field title
}
```

### Example Output

```json
[
  {
    "triggerField": "customer.classSegment",
    "triggerValue": "Associations",
    "errorField": "customer.classSegment",
    "suggestions": [
      {
        "field": "customer.classDescription",
        "currentValue": "Printing",
        "allowedValues": [
          "Clubs - civic, service or social",
          "Labor Union Offices",
          "Professional and Trade Associations"
        ],
        "isRequired": true,
        "title": "Class Description (select one)"
      }
    ],
    "type": "dependency"
  }
]
```

### Why `triggerField` and `errorField` Are Separate

The `triggerField` and `errorField` serve different purposes and can be different values:

**Case 1: Simple dependency - triggerField equals errorField**
```json
{
  "triggerField": "customer.classSegment",
  "triggerValue": "Associations", 
  "errorField": "customer.classSegment"
}
```
- **Scenario**: User sets `classSegment = "Associations"`, which triggers a dependency requiring `classDescription` to be one of specific values
- **Why same?**: The validation error is directly on the trigger field itself (wrong enum value for the dependency)
- **Meaning**: "Because you chose 'Associations', you must also set classDescription to one of these values"

**Case 2: Nested dependency - triggerField differs from errorField**
```json
{
  "triggerField": "objects.insuredItem.0.products.bpp.include",
  "triggerValue": "Yes",
  "errorField": "objects.insuredItem.0.products.bpp.financials.insurers"
}
```
- **Scenario**: User sets `include = "Yes"` at the product level, which triggers a nested dependency requiring `financials.insurers` array to have at least N items
- **Why different?**: The trigger field is higher in the object hierarchy than the field with the actual error
- **Meaning**: "Because you set include='Yes' in the product, the nested financials.insurers field must have at least 2 items"

**Key Insight:**
- `triggerField`: The field whose value activated a dependency rule (the "cause")
- `errorField`: The field that currently fails validation (the "effect")
- When they differ, it indicates a **cascading dependency** where a parent field's value creates requirements for nested/child fields

**Visual Example:**

```
Simple Dependency (triggerField === errorField):
┌─────────────────────────────────────────────────────┐
│ customer.classSegment = "Associations"              │ ← triggerField & errorField
│   ↓ triggers dependency                             │
│ customer.classDescription MUST BE one of:           │
│   ["Clubs", "Labor Union", "Associations"]          │
└─────────────────────────────────────────────────────┘

Cascading Dependency (triggerField ≠ errorField):
┌─────────────────────────────────────────────────────┐
│ products.bpp.include = "Yes"                        │ ← triggerField (cause)
│   ↓ triggers nested dependency                      │
│   ↓                                                  │
│ products.bpp.financials.insurers = []               │ ← errorField (effect)
│   (requires at least 2 items)                       │
└─────────────────────────────────────────────────────┘
```

## How It Works

### 1. **Error Detection & Parsing**

The system receives validation errors from RJSF with schema paths like:
```
#/properties/customer/dependencies/classSegment/oneOf/0/properties/classSegment/enum
```

This path tells us:
- Error is in `customer.classSegment` field
- It's part of a dependency rule
- The dependency is triggered by `classSegment` itself
- There are multiple possible schemas (`oneOf`)
- Current branch is index `0`

### 2. **Dependency Field Identification**

**Function:** `findDependencyField(schemaPath)`

Extracts the dependency trigger field from the schema path using regex:
```typescript
const match = schemaPath.match(/\/dependencies\/([^\/]+)\//);
```

For example: `"#/properties/customer/dependencies/classSegment/oneOf/1/properties/lro/enum"`
- Extracts: `"classSegment"` as the dependency field

### 3. **Schema Navigation**

**Function:** `getSchemaForPath(schema, parentPath)`

Navigates through nested schema structures to find the schema definition for a given field path.

- Handles nested objects: `customer.address.city`
- Handles arrays: `objects.insuredItem.0.products`
- Returns the schema definition at that path

### 4. **Dependency Chain Resolution**

**Function:** `findAllRequiredFields()`

Recursively explores dependency chains:

1. **Identify active dependencies**: Check which dependencies are triggered based on current form values
2. **Match oneOf branches**: Find which `oneOf` schema branch matches the current trigger value
3. **Extract requirements**: Collect all required fields and enum constraints from the matched branch
4. **Recurse for nested dependencies**: Check if any required fields themselves trigger more dependencies
5. **Avoid infinite loops**: Use a `visited` set to track already-processed dependency chains

### 5. **Validation & Filtering**

**Function:** `fieldExistsInSchema()`

Before adding a suggestion, verify the field actually exists in the flattened schema:
- Navigate through the schema structure
- Handle array indices properly
- Return `false` if field is not in the UI schema (internal-only fields)

### 6. **Nested Field Checking**

**Function:** `checkNestedRequiredFields()`

Handles complex nested structures:
- **Object properties**: Check required fields within nested objects
- **Array constraints**: Validate `minItems`, `maxItems`
- **Array item properties**: Check required fields for each array item
- **Type validation**: Ensure values match expected types (string, number, boolean)

## Current Limitations

### ⚠️ Parent Dependency Analysis Only

**Current behavior:** The system only analyzes "forward dependencies" - what fields are required given the current trigger value.

**Example:**
- `classSegment = "Associations"` → Shows what values `classDescription` must have
- ❌ Does NOT show: If user changes `classDescription`, what values could `classSegment` be changed to?

**What's missing:**
- **Reverse dependency lookup**: Given an error on a child field, suggest valid trigger values
- **Alternative paths**: Show multiple valid combinations of trigger + dependent fields
- **Optimal path finding**: Suggest the minimal set of changes to resolve all errors

### Example of Missing Functionality

Given this error:
```json
{
  "fieldPath": "customer.classDescription",
  "currentValue": "Printing",
  "message": "must be equal to one of allowed values"
}
```

**Current output:**
- ✅ Shows allowed values for `classDescription` given current `classSegment`
- ❌ Does NOT suggest changing `classSegment` to a value that would make "Printing" valid

**Desired output:**
```json
{
  "errorField": "customer.classDescription",
  "currentValue": "Printing",
  "suggestions": [
    {
      "field": "customer.classDescription",
      "allowedValues": ["Legal Office", "Medical Office"],
      "isRequired": true
    },
    {
      "field": "customer.classSegment",
      "currentValue": "Associations",
      "allowedValues": ["Contractors", "Manufacturing"],
      "note": "Alternative: Change classSegment to make current classDescription valid"
    }
  ]
}
```

## JSON Schema Dependency Structure

### How Dependencies Work

JSON Schema dependencies use the `dependencies` keyword combined with `oneOf` to create conditional schemas:

```json
{
  "properties": {
    "customer": {
      "type": "object",
      "properties": {
        "classSegment": { "type": "string" },
        "classDescription": { "type": "string" }
      },
      "dependencies": {
        "classSegment": {
          "oneOf": [
            {
              "properties": {
                "classSegment": { "enum": ["Associations"] },
                "classDescription": {
                  "enum": [
                    "Clubs - civic, service or social",
                    "Labor Union Offices"
                  ]
                }
              },
              "required": ["classDescription"]
            },
            {
              "properties": {
                "classSegment": { "enum": ["Contractors"] },
                "classDescription": {
                  "enum": [
                    "General Contractor",
                    "Specialty Contractor"
                  ]
                }
              },
              "required": ["classDescription"]
            }
          ]
        }
      }
    }
  }
}
```

**Interpretation:**
- When `classSegment = "Associations"`, `classDescription` must be one of: ["Clubs - civic, service or social", "Labor Union Offices"]
- When `classSegment = "Contractors"`, `classDescription` must be one of: ["General Contractor", "Specialty Contractor"]

## File Structure

```
dependency-helper/
├── fix-validation-errors.ts    # Main analysis logic
├── test-script.ts              # Test runner
├── tsconfig.json               # TypeScript configuration
├── package.json                # Dependencies
├── validation-errors.json      # Sample validation errors
├── form-data.json              # Sample form data
├── flattened-schema.json        # UI schema (what fields exist in form)
├── dc-schema.json              # Vendor schema (validation rules)
└── agents.md                   # This documentation
```

## Running the Code

### Prerequisites
1. Node.js installed
2. Dependencies installed: `npm install`
3. TypeScript compiler: Installed as dev dependency

### Execution
```bash
# Run with ts-node
ts-node test-script.ts

# Or use npx
npx ts-node test-script.ts
```

### Input Files

**validation-errors.json:**
```json
{
  "mappedErrors": [
    {
      "fieldPath": "customer.classSegment",
      "message": "must be equal to one of the allowed values",
      "originalError": {
        "property": ".customer.classSegment",
        "message": "must be equal to one of the allowed values",
        "params": { "allowedValues": ["LRO - Office"] },
        "schemaPath": "#/properties/customer/dependencies/classSegment/oneOf/0/..."
      }
    }
  ]
}
```

**form-data.json:**
```json
{
  "formData": {
    "customer": {
      "classSegment": "Associations",
      "classDescription": "Printing"
    }
  }
}
```

**Note:** The test script handles both wrapped (e.g., `{formData: {...}}`) and unwrapped formats.

## Key Algorithms

### Dependency Resolution Algorithm

```
For each validation error:
  1. Extract field path and schema path
  2. Identify dependency trigger field from schema path
  3. Get parent context (the object containing the dependency)
  4. Find current trigger value from form data
  5. Navigate to schema definition for that parent
  6. Find matching oneOf branch for current trigger value
  7. Recursively collect all required fields and constraints
  8. Filter suggestions to only include fields in flattened schema
  9. Group results by trigger field
```

### Schema Navigation Algorithm

```
Given: schema object, field path (e.g., "customer.address.city")

1. Split path into parts: ["customer", "address", "city"]
2. Start at schema.properties
3. For each part:
   - If part is numeric: Navigate into array items
   - If part is string: Navigate into object properties
   - Access the property with that name
4. Return final schema definition or null
```

## Future Enhancements

### 1. Field Labels for Display
**Status**: ⚠️ **TODO - High Priority**

Currently missing `triggerFieldLabel` and `errorFieldLabel` in the output, which are needed for user-friendly UI display.

**Implementation approach:**
```typescript
function getFieldLabel(fieldPath: string, ffSchema: RJSFSchema): string | undefined {
  const schema = getSchemaForPath(ffSchema, fieldPath);
  return schema?.title || fieldPath; // Fallback to path if no title
}
```

Then in `analyzeValidationErrors()`:
```typescript
groupedResults.push({
  triggerField: firstAnalysis.triggerField,
  triggerValue: firstAnalysis.triggerValue,
  triggerFieldLabel: getFieldLabel(firstAnalysis.triggerField, ffSchema),
  errorField: firstAnalysis.errorField,
  errorFieldLabel: getFieldLabel(firstAnalysis.errorField, ffSchema),
  suggestions: allSuggestions,
  type: "dependency",
});
```

**Why this matters:**
- Users see "Class Segment" instead of "customer.classSegment"
- Improves UI/UX when displaying validation error explanations
- Makes error messages more accessible to non-technical users

### 2. Reverse Dependency Analysis
- Given an error on a dependent field, suggest valid trigger values
- Show all possible paths to make current value valid

### 3. Multi-field Optimization
- Suggest minimal changes to fix all errors
- Prioritize changes that fix the most errors

### 4. Cascading Dependency Visualization
- Show full dependency tree
- Highlight active branches

### 5. Smart Suggestions
- Learn from user behavior
- Suggest most commonly used combinations

### 6. Validation Preview
- Show what would happen if a field is changed
- Preview new validation state before committing

## Dependencies

```json
{
  "dependencies": {
    "@rjsf/utils": "^5.24.13"  // RJSF type definitions
  },
  "devDependencies": {
    "@types/node": "^24.7.0",   // Node.js types
    "typescript": "^5.9.3"       // TypeScript compiler
  }
}
```

## Type Definitions

Key interfaces exported from `fix-validation-errors.ts`:

- `ValidationError`: Raw RJSF error format
- `MappedError`: Enhanced error with field path
- `Suggestion`: Single field fix recommendation
- `GroupedAnalysisResult`: Complete analysis result

## Testing

The `test-script.ts` file:
1. Loads sample data from JSON files
2. Runs analysis
3. Outputs formatted results to console
4. Handles errors with stack traces

## Troubleshooting

### Script runs but no output
- **Cause**: Missing `tsconfig.json`
- **Solution**: Create `tsconfig.json` with CommonJS module settings

### "validationErrors is not iterable"
- **Cause**: Wrong JSON structure (wrapped in object)
- **Solution**: Check for `mappedErrors` property wrapper

### "Cannot read properties of undefined"
- **Cause**: Schema navigation failed (missing or invalid schema structure)
- **Solution**: Verify schema file structure and field paths

### Fields not showing in suggestions
- **Cause**: Field doesn't exist in flattened schema
- **Solution**: Check `fieldExistsInSchema()` logic and flattened schema

## Contributing

When extending this codebase:

1. **Add reverse dependency lookup**: Implement algorithm to find valid trigger values for a given dependent field value
2. **Improve schema navigation**: Handle more edge cases (conditional schemas, $ref references)
3. **Add caching**: Cache schema lookups and dependency resolutions
4. **Enhance error messages**: Provide more context about why a suggestion is being made
5. **Add validation**: Verify suggestions would actually resolve the error

## Notes for AI Agents

- Always check both `ffSchema` and `schema` - they serve different purposes
  - `ffSchema`: flattened schema containing UI field definitions and titles
  - `schema`: Vendor/validation schema containing dependency rules and constraints
- The `visited` set in `findAllRequiredFields()` prevents infinite recursion
- Schema paths use JSON Pointer syntax (`#/properties/...`)
- Field paths use dot notation (`customer.classSegment`)
- Array indices in paths are numeric strings ("0", "1", etc.)
- The `oneOf` matching is based on enum values in properties
- Not all schema fields appear in the flattened schema (backend-only fields)
- **triggerField vs errorField**: These are separate because:
  - `triggerField` = the field whose value triggers the dependency (the cause)
  - `errorField` = the field that has the validation error (the effect)
  - When they're the same: simple dependency on the field itself
  - When they differ: cascading dependency where parent triggers requirements on children
- **Field labels**: Use `schema?.title` from flattened schema to get human-readable labels
  - Navigate to field using `getSchemaForPath()` with the field path
  - Extract the `title` property for display purposes
  - Fallback to the field path if no title is defined
