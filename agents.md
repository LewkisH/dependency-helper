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
Object containing analysis results and list of fields missing in flattened schema.

### Output Format

```typescript
interface ValidationAnalysisOutput {
  analyses: GroupedAnalysisResult[];
  missingInFlattenedSchema: MissingFieldInfo[];
}

interface MissingFieldInfo {
  errorField: string;        // The field with the validation error
  missingFields: string[];   // Fields suggested for this error that don't exist in flattened schema
}

interface GroupedAnalysisResult {
  triggerField?: string;        // The field that triggered the dependency (only for type="dependency")
  triggerValue?: any;           // Current value of the trigger field (only for type="dependency")
  triggerFieldLabel?: string;   // Human-readable label for the trigger field
  errorField: string;           // The field with the validation error
  errorFieldLabel?: string;     // Human-readable label for the error field
  errorFieldCurrentValue?: any; // Current value of the error field
  suggestions: Suggestion[];    // Array of fields to fix
  type: "dependency" | "simple" // "dependency" = forward (what to change given trigger)
                                // "simple" = reverse (alternative trigger values)
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

The system returns **two separate result objects** for bidirectional dependencies:

**1. Forward Dependency (type="dependency"):** Shows what dependent fields need to change given the current trigger value.

**2. Reverse Dependency (type="simple"):** Shows alternative trigger values that would make the current error value valid.

```json
{
  "analyses": [
    {
      "triggerField": "customer.classSegment",
      "triggerValue": "Associations",
      "triggerFieldLabel": "Class Segment (select one)",
      "errorField": "customer.classSegment",
      "errorFieldLabel": "Class Segment (select one)",
      "errorFieldCurrentValue": "Associations",
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
    },
    {
      "errorField": "customer.classDescription",
      "errorFieldLabel": "Class Description (select one)",
      "errorFieldCurrentValue": "Printing",
      "suggestions": [
        {
          "field": "customer.classSegment",
          "currentValue": "Associations",
          "allowedValues": ["Business Services"],
          "isRequired": true,
          "title": "Class Segment (select one)"
        }
      ],
      "type": "simple"
    }
  ],
  "missingInFlattenedSchema": []
}
```

### Understanding `missingInFlattenedSchema`

The `missingInFlattenedSchema` field is a top-level array that groups missing fields by their associated error field. Each entry shows which error field is causing which suggested fields to be flagged as missing from the flattened UI schema.

**Structure:**
- **`errorField`**: The field with the validation error
- **`missingFields`**: Array of suggested fields for this error that don't exist in the flattened schema

This helps distinguish between:
- **UI fields**: Fields that appear in the form interface (exist in flattened schema)
- **Validation-only fields**: Fields required by validation rules but not rendered in the UI

**Example:**
```json
{
  "analyses": [
    {
      "triggerField": "objects.insuredItem.0.products.option.include",
      "triggerValue": true,
      "suggestions": [
        {
          "field": "objects.insuredItem.0.products.option.financials.insurers",
          "allowedValues": ["at least 1 items"],
          "isRequired": true
        }
      ],
      "type": "dependency"
    }
  ],
  "missingInFlattenedSchema": [
    {
      "errorField": "objects.insuredItem.0.products.option.include",
      "missingFields": [
        "objects.insuredItem.0.products.option.financials.insurers"
      ]
    }
  ]
}
```

**Interpretation:** The validation error on `option.include` is suggesting to add the `financials.insurers` field, but that field doesn't exist in the flattened UI schema. This might indicate:
- The field needs to be added to the UI
- The field is backend-only and cannot be directly edited by users
- There's a mismatch between validation schema and UI schema

### Understanding Result Types: "dependency" vs "simple"

The `type` field indicates the direction of dependency analysis:

- **`type: "dependency"`** (Forward Dependency)
  - Has `triggerField` and `triggerValue` populated
  - Shows what dependent fields need to change given the current trigger value
  - Answers: "Given my current choice in field A, what must field B be?"
  - Example: classSegment="Associations" → classDescription must be one of ["Clubs", "Labor Union", ...]

- **`type: "simple"`** (Reverse Dependency)
  - Does NOT have `triggerField` or `triggerValue`
  - Shows alternative trigger values that would make the current error value valid
  - Answers: "What could I change field A to, so that my current value in field B becomes valid?"
  - Example: classDescription="Printing" (currently invalid) → classSegment could be "Business Services"

**Key Insight:** For bidirectional dependencies, the system returns **two separate result objects** - one for forward dependencies and one for reverse dependencies. This allows the UI to present both "fix the dependent field" and "change the trigger field" as distinct options to the user.

### Why `triggerField` and `errorField` Are Separate

The `triggerField` and `errorField` serve different purposes and can be different values:

**Case 1: Simple dependency - triggerField equals errorField**
```json
{
  "triggerField": "customer.classSegment",
  "triggerValue": "Associations",
  "triggerFieldLabel": "Class Segment (select one)",
  "errorField": "customer.classSegment",
  "errorFieldLabel": "Class Segment (select one)"
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
  "triggerFieldLabel": "Include BPP",
  "errorField": "objects.insuredItem.0.products.bpp.financials.insurers",
  "errorFieldLabel": "Insurers"
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

### 0. **Schema Validation**

Before processing any errors, the system validates that the schema is properly dereferenced:

**Function:** `hasRefs(schema)`

- Uses JSON.stringify and regex to detect any `$ref` references in the schema
- If `$ref` references are found:
  - Logs a warning with the count of references
  - Aborts analysis and returns an empty array
  - Instructs users to dereference the schema before use
- This prevents incorrect results from unresolved references

**Why this matters:** The tool relies on navigating the full schema structure. `$ref` references must be resolved (dereferenced) beforehand, or the navigation will fail to find dependency definitions.

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

Recursively explores forward dependency chains:

1. **Identify active dependencies**: Check which dependencies are triggered based on current form values
2. **Match oneOf branches**: Find which `oneOf` schema branch matches the current trigger value
3. **Extract requirements**: Collect all required fields and enum constraints from the matched branch
4. **Recurse for nested dependencies**: Check if any required fields themselves trigger more dependencies
5. **Avoid infinite loops**: Use a `visited` set to track already-processed dependency chains

**Function:** `findReverseDependencies()`

Finds alternative trigger values that would make the current error value valid:

1. **Get dependency schema**: Navigate to the schema containing the dependency definition
2. **Iterate through oneOf branches**: Check each possible schema branch
3. **Match error value**: Find branches where the error value is in the allowed enum values
4. **Extract trigger values**: Get the corresponding trigger field enum values from matching branches
5. **Filter current value**: Exclude the current trigger value (since it's already invalid)
6. **Return alternatives**: Return array of valid trigger values that would make the error value valid

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

## Current Capabilities

### ✅ Bidirectional Dependency Analysis

**Implemented Features:**

1. **Forward Dependencies (type="dependency")**
   - Analyzes what dependent fields need to change given the current trigger value
   - Example: `classSegment = "Associations"` → Shows allowed values for `classDescription`
   - Provides `triggerField` and `triggerValue` context

2. **Reverse Dependencies (type="simple")**
   - Finds alternative trigger values that would make the current error value valid
   - Example: `classDescription = "Printing"` (invalid) → Suggests changing `classSegment` to "Business Services"
   - Does NOT include `triggerField`/`triggerValue` (since we're suggesting changing the trigger)

3. **Deduplication**
   - Handles JSON Schema `oneOf` structures that generate multiple errors per field
   - Returns one result per `errorField:type` combination

4. **Self-reference Filtering**
   - Suggestions never reference the error field itself
   - Only suggests changes to OTHER fields
   - Example: Error on `classDescription` won't suggest changing `classDescription`

### Real-World Example

Given this validation error:
```json
{
  "fieldPath": "customer.classDescription",
  "currentValue": "Printing",
  "message": "must be equal to one of allowed values"
}
```

**Current output includes BOTH:**

**Option 1 - Forward dependency (fix dependent field):**
```json
{
  "triggerField": "customer.classSegment",
  "triggerValue": "Associations",
  "errorField": "customer.classSegment",
  "suggestions": [
    {
      "field": "customer.classDescription",
      "allowedValues": ["Clubs - civic, service or social", "Labor Union Offices", ...]
    }
  ],
  "type": "dependency"
}
```

**Option 2 - Reverse dependency (change trigger field):**
```json
{
  "errorField": "customer.classDescription",
  "suggestions": [
    {
      "field": "customer.classSegment",
      "currentValue": "Associations",
      "allowedValues": ["Business Services"]
    }
  ],
  "type": "simple"
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

### Forward Dependency Resolution Algorithm

```
For each validation error:
  1. Extract field path and schema path
  2. Identify dependency trigger field from schema path
  3. Get parent context (the object containing the dependency)
  4. Find current trigger value from form data
  5. Navigate to schema definition for that parent
  6. Find matching oneOf branch for current trigger value
  7. Recursively collect all required fields and constraints
  8. Filter suggestions to exclude the error field itself
  9. Filter suggestions to only include fields in flattened schema
  10. Return as type="dependency" result
```

### Reverse Dependency Resolution Algorithm

```
For each validation error on a dependent field:
  1. Extract field path and current (invalid) value
  2. Identify dependency trigger field from schema path
  3. Navigate to parent schema with dependency definition
  4. Iterate through all oneOf branches:
     a. Check if error value is in the branch's enum for error field
     b. If yes, extract trigger field's enum values from that branch
     c. Collect all matching trigger values
  5. Filter out current trigger value (already invalid)
  6. If alternative trigger values exist:
     a. Create suggestion with trigger field and alternative values
     b. Return as type="simple" result (no triggerField/triggerValue)
  7. Return null if no alternatives found
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

## Future Enhancement Ideas

### Completed Features

#### Field Labels and Current Values
**Status**: ✅ **Implemented**

The system now includes human-readable labels and current values for all fields in the output:

- `triggerFieldLabel` and `errorFieldLabel`: Human-readable field titles extracted from the flattened schema
- `errorFieldCurrentValue`: The current (invalid) value of the error field for both dependency and simple types

**Implementation:**
- `getFieldLabel(fieldPath, ffSchema)` function navigates the schema to extract the `title` property
- Falls back to the field path if no title is defined
- Handles nested objects and array indices properly
- Labels are populated for both dependency and simple error types
- `errorFieldCurrentValue` is extracted from the `AnalysisResult.currentValue` and included in both result types

**Example:**
```typescript
{
  "triggerFieldLabel": "Class Segment (select one)",  // Instead of "customer.classSegment"
  "errorFieldLabel": "Class Description (select one)",  // Instead of "customer.classDescription"
  "errorFieldCurrentValue": "Printing"  // The current invalid value
}
```

#### Schema Reference Validation
**Status**: ✅ **Implemented**

The system validates that the input schema is fully dereferenced before processing:

**Implementation:**
- `hasRefs(schema)` function uses JSON.stringify + regex to detect `$ref` references
- Fast O(n) string search instead of recursive object traversal
- If `$ref` found, logs warning with count and aborts analysis
- Returns empty array to prevent incorrect results from unresolved references
- Validates on every call to `analyzeValidationErrors()`

**Why it matters:** The tool cannot navigate through `$ref` references. Schemas must be dereferenced (e.g., using `@apidevtools/json-schema-ref-parser`) before use.

#### Reverse Dependency Analysis
**Status**: ✅ **Implemented**

The system now analyzes bidirectional dependencies and returns separate result objects:

**Implementation:**
- `findReverseDependencies()` function searches all `oneOf` branches to find alternative trigger values
- `analyzeDependencyError()` returns array with both forward (type="dependency") and reverse (type="simple") results
- Self-reference filtering ensures suggestions only include OTHER fields
- Deduplication handles JSON Schema `oneOf` multiple error generation
- Current value filtering excludes already-invalid trigger values from suggestions

**Example:**
```typescript
// Forward dependency
{
  "triggerField": "customer.classSegment",
  "triggerValue": "Associations",
  "errorField": "customer.classSegment",
  "suggestions": [{"field": "customer.classDescription", ...}],
  "type": "dependency"
}

// Reverse dependency
{
  "errorField": "customer.classDescription",
  "suggestions": [{"field": "customer.classSegment", "allowedValues": ["Business Services"]}],
  "type": "simple"
}
```

### Potential Future Improvements

Some potential areas for improvement:

- **Multi-field optimization**: Analyze all errors together and suggest the minimal set of changes to resolve everything at once
- **Dependency tree visualization**: Display the full cascade of dependencies to help users understand complex relationships
- **Smart suggestions**: Track commonly used field combinations to provide context-aware recommendations
- **Validation preview**: Show what the validation state would be after applying a suggested change
- **Performance optimization**: Cache schema lookups and dependency resolutions for large schemas
- **Enhanced error context**: Include more semantic information about why a dependency constraint exists

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

## Extending the Codebase

When extending this codebase, consider these areas:

- **Schema navigation improvements**: Handle more edge cases like conditional schemas, $ref references (after dereferencing), allOf/anyOf patterns
- **Performance optimizations**: Add caching for schema lookups and dependency resolutions when working with large schemas
- **Error message enhancements**: Provide more semantic context about why specific suggestions are made
- **Validation verification**: Verify that suggestions would actually resolve the error before returning them
- **Circular dependency detection**: Add safeguards to detect and handle circular dependency chains gracefully
- **Complex oneOf support**: Improve handling of deeply nested or complex oneOf structures

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
- **Result types**:
  - `type: "dependency"` = Forward dependency with `triggerField`/`triggerValue` showing what dependent fields need
  - `type: "simple"` = Reverse dependency without `triggerField`/`triggerValue` showing alternative trigger values
- **Bidirectional results**: For each dependency error pair, return TWO separate objects:
  1. Forward dependency (what to change given current trigger)
  2. Reverse dependency (what trigger values would make current value valid)
- **Deduplication**: JSON Schema `oneOf` generates N errors for N branches, deduplicate by `${errorField}:${type}`
- **Self-reference filtering**: Never suggest changing the error field itself - only suggest OTHER fields
  - Filter: `suggestions.filter(s => s.field !== fieldPath)`
  - This ensures forward dependencies suggest changing dependent fields, not the trigger
- **Current value filtering**: In reverse dependencies, exclude current trigger value from alternatives
  - It's already invalid, so no point suggesting it again
- **missingInFlattenedSchema**: Array of `MissingFieldInfo` objects grouping missing fields by error field
  - Each entry contains `errorField` (the field with validation error) and `missingFields` (array of suggested fields not in flattened schema)
  - Built by checking each suggestion's field with `fieldExistsInSchema()` and grouping by `result.errorField`
  - Helps identify which validation errors are suggesting fields that don't exist in the UI
  - Nested required fields in dependencies are reported even if not in flattened schema (validation schema is source of truth)
