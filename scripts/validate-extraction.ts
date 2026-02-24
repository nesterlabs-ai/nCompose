#!/usr/bin/env tsx
/**
 * Validation script to compare our extraction with Builder.io plugin extraction
 */

import 'dotenv/config';
import { FigmaClient } from '../src/figma/fetch.js';
import { extractCompleteDesign, allExtractors } from '../src/figma-complete/index.js';
import { parseComponentSet } from '../src/figma/component-set-parser.js';

const BUTTON_DANGER_URL = 'https://www.figma.com/design/rAim3nrWukuYQQRmYU1L8r/SquareX-Design-System--Copy-?node-id=8119-29710&m=dev';
const FILE_KEY = 'rAim3nrWukuYQQRmYU1L8r';
const NODE_ID = '8119:29710';

// Builder.io plugin extraction (provided by user)
const BUILDER_IO_EXTRACTION = {
  componentSetName: "ButtonDanger",
  variantProperties: {
    Style: ["Subtle", "Primary", "Neutral"],
    State: ["Default", "Hover", "Focus", "Disabled", "Loading"],
    Size: ["Medium", "Small"]
  },
  componentProperties: {
    "Choose Left Icon#3371:130": { type: "INSTANCE_SWAP", defaultValue: "8119:29334" },
    "Choose Right Icon#3371:141": { type: "INSTANCE_SWAP", defaultValue: "8119:29334" },
    "Show Left Icon#3371:152": { type: "BOOLEAN", defaultValue: true },
    "Show Right Icon#3371:163": { type: "BOOLEAN", defaultValue: true },
    "Label#3375:41": { type: "TEXT", defaultValue: "Button" }
  },
  totalVariants: 30
};

async function main() {
  console.log('🔍 Validating Figma Extraction vs Builder.io Plugin\n');
  console.log('=' .repeat(80));

  // Fetch from Figma API
  const figmaToken = process.env.FIGMA_TOKEN;
  if (!figmaToken) {
    throw new Error('FIGMA_TOKEN environment variable is required');
  }

  const client = new FigmaClient(figmaToken);
  console.log('📥 Fetching Figma data...');
  const rawData = await client.getNode(FILE_KEY, NODE_ID, 25);

  // Extract complete design
  console.log('🔬 Extracting complete design data...\n');
  const completeDesign = extractCompleteDesign(rawData, allExtractors, {
    maxDepth: 25,
    preserveHiddenNodes: false,
    includeAbsoluteBounds: true,
    includeRelativeTransform: true,
  });

  // Parse component set
  const componentSetData = parseComponentSet(completeDesign);
  if (!componentSetData) {
    throw new Error('Failed to parse component set');
  }

  console.log('=' .repeat(80));
  console.log('\n📊 COMPARISON RESULTS\n');

  // 1. Component Name
  console.log('1️⃣  COMPONENT NAME');
  console.log('   Builder.io: ' + BUILDER_IO_EXTRACTION.componentSetName);
  console.log('   Ours:       ' + componentSetData.name);
  console.log('   ✅ Match:    ' + (componentSetData.name === BUILDER_IO_EXTRACTION.componentSetName));

  // 2. Variant Axes
  console.log('\n2️⃣  VARIANT AXES (Property Axes)');
  console.log('   Builder.io axes:', Object.keys(BUILDER_IO_EXTRACTION.variantProperties).join(', '));
  console.log('   Our axes:       ', componentSetData.axes.map(a => a.name).join(', '));

  for (const [axisName, values] of Object.entries(BUILDER_IO_EXTRACTION.variantProperties)) {
    const ourAxis = componentSetData.axes.find(a => a.name === axisName);
    console.log(`\n   Axis: ${axisName}`);
    console.log(`     Builder.io values: ${values.join(', ')}`);
    console.log(`     Our values:        ${ourAxis ? ourAxis.values.join(', ') : 'NOT FOUND'}`);
    const match = ourAxis && JSON.stringify(values.sort()) === JSON.stringify(ourAxis.values.sort());
    console.log(`     ✅ Match: ${match}`);
  }

  // 3. Total Variants
  console.log('\n3️⃣  TOTAL VARIANTS');
  console.log('   Builder.io: ' + BUILDER_IO_EXTRACTION.totalVariants);
  console.log('   Ours:       ' + componentSetData.variants.length);
  console.log('   ✅ Match:    ' + (componentSetData.variants.length === BUILDER_IO_EXTRACTION.totalVariants));

  // 4. Component Properties (THE CRITICAL PART)
  console.log('\n4️⃣  COMPONENT PROPERTIES');
  console.log('   Builder.io properties:', Object.keys(BUILDER_IO_EXTRACTION.componentProperties).length);
  console.log('   Our properties:       ', componentSetData.componentPropertyDefinitions
    ? Object.keys(componentSetData.componentPropertyDefinitions).length
    : 0);

  if (!componentSetData.componentPropertyDefinitions || Object.keys(componentSetData.componentPropertyDefinitions).length === 0) {
    console.log('\n   ⚠️  WARNING: No component properties found in our extraction!');
    console.log('   This means componentPropertyDefinitions is missing from the extraction.');
  } else {
    console.log('\n   Detailed comparison:');

    // Compare each property
    for (const [propName, propDef] of Object.entries(BUILDER_IO_EXTRACTION.componentProperties)) {
      const cleanName = propName.replace(/#\d+:\d+$/, '');
      console.log(`\n   Property: ${propName}`);
      console.log(`     Type:         ${propDef.type}`);
      console.log(`     Default:      ${propDef.defaultValue}`);

      // Find in our extraction
      const ourProp = componentSetData.componentPropertyDefinitions[propName];
      if (ourProp) {
        console.log(`     ✅ Found in our extraction`);
        console.log(`        Our type:    ${ourProp.type}`);
        console.log(`        Our default: ${ourProp.defaultValue}`);
        const typeMatch = ourProp.type === propDef.type;
        console.log(`        Type match:  ${typeMatch ? '✅' : '❌'}`);
      } else {
        console.log(`     ❌ NOT FOUND in our extraction`);
      }
    }
  }

  // 5. Classified Properties
  console.log('\n5️⃣  CLASSIFIED PROPERTIES');
  console.log('   INSTANCE_SWAP (Icon Slots):');
  console.log('     Builder.io count: 2');
  console.log('     Our count:        ' + (componentSetData.iconSlotProperties?.length || 0));
  if (componentSetData.iconSlotProperties) {
    for (const prop of componentSetData.iconSlotProperties) {
      console.log(`       - ${prop.name} (type: ${prop.type})`);
    }
  }

  console.log('\n   BOOLEAN (Visibility Toggles):');
  console.log('     Builder.io count: 2');
  console.log('     Our count:        ' + (componentSetData.booleanVisibilityProperties?.length || 0));
  if (componentSetData.booleanVisibilityProperties) {
    for (const prop of componentSetData.booleanVisibilityProperties) {
      console.log(`       - ${prop.name} (type: ${prop.type}, default: ${prop.defaultValue})`);
    }
  }

  console.log('\n   TEXT (Content Properties):');
  console.log('     Builder.io count: 1');
  console.log('     Our count:        ' + (componentSetData.textContentProperties?.length || 0));
  if (componentSetData.textContentProperties) {
    for (const prop of componentSetData.textContentProperties) {
      console.log(`       - ${prop.name} (type: ${prop.type}, default: "${prop.defaultValue}")`);
    }
  }

  // Summary
  console.log('\n' + '=' .repeat(80));
  console.log('\n📋 SUMMARY\n');

  const allMatch =
    componentSetData.name === BUILDER_IO_EXTRACTION.componentSetName &&
    componentSetData.variants.length === BUILDER_IO_EXTRACTION.totalVariants &&
    componentSetData.componentPropertyDefinitions &&
    Object.keys(componentSetData.componentPropertyDefinitions).length === Object.keys(BUILDER_IO_EXTRACTION.componentProperties).length;

  if (allMatch) {
    console.log('✅ All extraction data matches Builder.io plugin output!');
    console.log('✅ No properties are missing.');
  } else {
    console.log('❌ Some discrepancies found:');

    if (componentSetData.name !== BUILDER_IO_EXTRACTION.componentSetName) {
      console.log('   - Component name mismatch');
    }

    if (componentSetData.variants.length !== BUILDER_IO_EXTRACTION.totalVariants) {
      console.log('   - Variant count mismatch');
    }

    if (!componentSetData.componentPropertyDefinitions || Object.keys(componentSetData.componentPropertyDefinitions).length !== Object.keys(BUILDER_IO_EXTRACTION.componentProperties).length) {
      console.log('   - Component properties count mismatch');
    }
  }

  console.log('\n' + '=' .repeat(80));

  // Debug: Print raw componentPropertyDefinitions
  console.log('\n🔍 DEBUG: Raw componentPropertyDefinitions from extraction:');
  console.log(JSON.stringify(componentSetData.componentPropertyDefinitions, null, 2));
}

main().catch(console.error);
