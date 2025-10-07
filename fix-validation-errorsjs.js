#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the JSON files
const validationErrors = JSON.parse(fs.readFileSync(path.join(__dirname, 'validation-errors.json'), 'utf8'));
const formData = JSON.parse(fs.readFileSync(path.join(__dirname, 'form-data.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'dc-schema.json'), 'utf8'));

/**
 * Get nested property value from an object using dot notation
 */
function getNestedValue(obj, pathString) {
  const keys = pathString.replace(/^\./, '').split('.');
  return keys.reduce((current, key) => {
    if (current && typeof current === 'object') {
      // Handle array indices
      if (!isNaN(key)) {
        return current[parseInt(key)];
      }
      return current[key];
    }
    return undefined;
  }, obj);
}

/**
 * Parse the schema path to find parent object path
 */
function getParentPath(fieldPath) {
  const parts = fieldPath.split('.');
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join('.');
}

/**
 * Find the dependency field that triggered the error
 */
function findDependencyField(schemaPath) {
  // Extract dependency field from schema path like:
  // "#/properties/customer/dependencies/lro/oneOf/1/properties/lro/enum"
  const match = schemaPath.match(/\/dependencies\/([^\/]+)\//);
  return match ? match[1] : null;
}

/**
 * Get the schema object for a given parent path
 */
function getSchemaForPath(schema, parentPath) {
  if (!parentPath) return schema.properties;
  
  const parentSchemaPath = parentPath.replace(/\.\d+\./g, '.').split('.');
  let currentSchema = schema.properties;
  
  for (const part of parentSchemaPath) {
    if (currentSchema && currentSchema[part]) {
      currentSchema = currentSchema[part];
    }
  }
  
  return currentSchema;
}

/**
 * Find all cascading dependencies for a given object and its current values
 * This recursively explores all dependency chains
 */
function findAllRequiredFields(parentSchema, parentData, parentPath, visited = new Set()) {
  const suggestions = [];
  
  if (!parentSchema || !parentSchema.dependencies) {
    return suggestions;
  }
  
  // Iterate through all dependencies defined in the schema
  for (const [depFieldName, depRule] of Object.entries(parentSchema.dependencies)) {
    const depValue = parentData?.[depFieldName];
    
    // Skip if we don't have a value for this dependency trigger
    if (depValue === undefined) continue;
    
    // Create a unique key to avoid infinite loops
    const visitKey = `${parentPath || 'root'}.${depFieldName}:${depValue}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    
    // Check if this dependency has oneOf schemas
    if (depRule.oneOf) {
      // Find the matching oneOf schema for the current dependency value
      const matchingSchema = depRule.oneOf.find(s => {
        const enumValues = s.properties?.[depFieldName]?.enum;
        return enumValues && enumValues.includes(depValue);
      });
      
      if (matchingSchema) {
        const required = matchingSchema.required || [];
        
        // Check all properties in the matching schema
        for (const [propName, propSchema] of Object.entries(matchingSchema.properties || {})) {
          if (propName === depFieldName) continue; // Skip the trigger field itself
          
          const propPath = parentPath ? `${parentPath}.${propName}` : propName;
          const propValue = parentData?.[propName];
          
          // Check if property has enum constraints
          if (propSchema.enum) {
            const isValid = propSchema.enum.includes(propValue);
            if (!isValid || propValue === undefined) {
              suggestions.push({
                field: propPath,
                currentValue: propValue !== undefined ? propValue : '(not set)',
                allowedValues: propSchema.enum,
                isRequired: required.includes(propName),
                title: propSchema.title || propName
              });
            }
          }
          
          // Check if property is required but missing (and doesn't have enum)
          else if (required.includes(propName) && propValue === undefined) {
            const allowedValues = propSchema.enum || 
                                 (propSchema.type === 'number' ? ['(a number)'] : 
                                  propSchema.type === 'array' ? ['(an array)'] : 
                                  ['(value required)']);
            suggestions.push({
              field: propPath,
              currentValue: '(not set)',
              allowedValues: allowedValues,
              isRequired: true,
              title: propSchema.title || propName
            });
          }
        }
        
        // Now recursively check if any of the current values trigger more dependencies
        // For example, if classSegment is set, check if there's a dependency on classSegment
        for (const [propName, propValue] of Object.entries(parentData || {})) {
          if (propValue !== undefined && parentSchema.dependencies?.[propName]) {
            const nestedSuggestions = findAllRequiredFields(
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
function analyzeDependencyError(error, formData, schema) {
  const fieldPath = error.fieldPath;
  const schemaPath = error.originalError.schemaPath;
  
  // Get current value in form
  const currentValue = getNestedValue(formData.manualPayload, fieldPath);
  
  // Find the dependency field from the schema path
  const dependencyField = findDependencyField(schemaPath);
  
  if (dependencyField) {
    const parentPath = getParentPath(fieldPath);
    const parentData = parentPath ? getNestedValue(formData.manualPayload, parentPath) : formData.manualPayload;
    
    // Get the dependency trigger value
    const triggerValue = parentData ? parentData[dependencyField] : undefined;
    
    // Get the schema for this parent object
    const parentSchema = getSchemaForPath(schema, parentPath);
    
    // Find ALL required fields by exploring the full dependency chain
    const allSuggestions = findAllRequiredFields(parentSchema, parentData, parentPath);
    
    if (allSuggestions.length > 0) {
      return {
        triggerField: parentPath ? `${parentPath}.${dependencyField}` : dependencyField,
        triggerValue: triggerValue,
        errorField: fieldPath,
        currentValue: currentValue,
        suggestions: allSuggestions
      };
    }
  }
  
  // Handle simple enum errors
  if (error.originalError.params?.allowedValues) {
    return {
      errorField: fieldPath,
      currentValue: currentValue !== undefined ? currentValue : '(not set)',
      suggestions: [{
        field: fieldPath,
        currentValue: currentValue !== undefined ? currentValue : '(not set)',
        allowedValues: error.originalError.params.allowedValues,
        isRequired: true
      }]
    };
  }
  
  // Handle minItems errors
  if (error.originalError.params?.limit && error.message.includes('fewer than')) {
    const currentLength = Array.isArray(currentValue) ? currentValue.length : 0;
    return {
      errorField: fieldPath,
      currentValue: `array with ${currentLength} items`,
      suggestions: [{
        field: fieldPath,
        currentValue: `array with ${currentLength} items`,
        allowedValues: [`at least ${error.originalError.params.limit} items`],
        isRequired: true
      }]
    };
  }
  
  return null;
}

/**
 * Format value for display
 */
function formatValue(value) {
  if (value === null) return '(null)';
  if (value === '') return '(empty string)';
  if (value === undefined) return '(not set)';
  if (value === false) return 'false';
  if (value === true) return 'true';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * Main function to analyze all errors
 */
function analyzeValidationErrors() {
  console.log('\n=== VALIDATION ERROR ANALYSIS ===\n');
  
  const analyzed = new Set();
  const results = [];
  
  // Analyze each validation error
  for (const error of validationErrors) {
    const fieldPath = error.fieldPath;
    
    // Skip if we've already analyzed this field
    if (analyzed.has(fieldPath)) continue;
    
    const analysis = analyzeDependencyError(error, formData, schema);
    
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
  const grouped = {};
  
  for (const result of results) {
    const key = result.triggerField || result.errorField;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(result);
  }
  
  // Display each group
  for (const [triggerField, analyses] of Object.entries(grouped)) {
    const firstAnalysis = analyses[0];
    
    if (firstAnalysis.triggerField && firstAnalysis.triggerValue !== undefined) {
      console.log(`📋 If you want "${firstAnalysis.triggerField}" to be "${formatValue(firstAnalysis.triggerValue)}", you should set:\n`);
      
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
        console.log(`   ${index + 1}. "${suggestion.field}"${suggestion.title ? ` (${suggestion.title})` : ''} to one of:`);
        suggestion.allowedValues.forEach(value => {
          console.log(`      - "${formatValue(value)}"`);
        });
        console.log(`      (currently: "${formatValue(suggestion.currentValue)}")`);
        console.log();
      });
    } else {
      // Simple error without dependency trigger
      console.log(`📋 Field "${firstAnalysis.errorField}" has validation errors:\n`);
      
      for (const suggestion of firstAnalysis.suggestions) {
        console.log(`   • Must be set to one of:`);
        suggestion.allowedValues.forEach(value => {
          console.log(`      - "${formatValue(value)}"`);
        });
        console.log(`      (currently: "${formatValue(suggestion.currentValue)}")`);
        console.log();
      }
    }
  }
  
  console.log('=================================\n');
}

// Run the analysis
analyzeValidationErrors();
