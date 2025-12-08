// Script to generate rhythm graph data from rhythms.csv
// Run with: node scripts/generate-rhythm-graph.mjs

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvPath = join(__dirname, '..', 'src', 'rhythms.csv');
const outputPath = join(__dirname, '..', 'src', 'rhythmGraphData.json');

/**
 * Parse a hex digits string like "A 5 3 C" into a normalized string "A53C"
 */
function parseHexDigits(digitsString) {
  return digitsString.replace(/\s+/g, '').toUpperCase();
}

/**
 * Split an 8-hex rhythm into two 4-hex rhythms
 */
function split8HexTo4Hex(hex8) {
  if (hex8.length !== 8) {
    throw new Error(`Expected 8-character hex, got: ${hex8}`);
  }
  const first = hex8.slice(0, 4);
  const second = hex8.slice(4, 8);
  return [first, second];
}

/**
 * Parse the CSV and extract rhythm data
 */
function parseRhythmsCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  const rhythms4 = new Set();  // All 4-hex rhythms
  const rhythms8 = [];         // All 8-hex rhythms (pairs)

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line - handle quoted strings
    const match = line.match(/^(\w+),(\d+),(\d+),(\d+),"([^"]+)"(?:,"([^"]*)")?$/);
    if (!match) {
      console.warn(`Could not parse line ${i + 1}: ${line}`);
      continue;
    }

    const [, mode, numerator, denominator, onsets, digitsString] = match;
    
    if (mode !== 'hex') continue;

    const hexDigits = parseHexDigits(digitsString);
    const numBeats = parseInt(numerator, 10);

    if (numBeats === 4 && hexDigits.length === 4) {
      // 4-beat rhythm
      rhythms4.add(hexDigits);
    } else if (numBeats === 8 && hexDigits.length === 8) {
      // 8-beat rhythm - this defines a relation between two 4-beat rhythms
      rhythms8.push(hexDigits);
    }
  }

  return { rhythms4, rhythms8 };
}

/**
 * Build a graph where nodes are 4-hex rhythms and edges connect rhythms
 * that appear together in an 8-hex rhythm.
 * Only includes nodes that have at least one connection.
 */
function buildRhythmGraph(rhythms4, rhythms8) {
  // First, collect all rhythms that appear in 8-hex pairs (these will have connections)
  const connectedRhythms = new Map(); // rhythm -> Set of connected rhythms

  for (const hex8 of rhythms8) {
    const [first, second] = split8HexTo4Hex(hex8);
    
    if (!connectedRhythms.has(first)) {
      connectedRhythms.set(first, new Set());
    }
    if (!connectedRhythms.has(second)) {
      connectedRhythms.set(second, new Set());
    }
    
    // Add bidirectional edges
    connectedRhythms.get(first).add(second);
    connectedRhythms.get(second).add(first);
  }

  // Create sorted node list from connected rhythms only
  const nodes = Array.from(connectedRhythms.keys()).sort();
  const nodeIndex = new Map(nodes.map((n, i) => [n, i]));

  // Build adjacency list using indices
  const adjacency = nodes.map(node => {
    const neighbors = connectedRhythms.get(node);
    return Array.from(neighbors)
      .map(n => nodeIndex.get(n))
      .filter(i => i !== undefined)
      .sort((a, b) => a - b);
  });

  return { nodes, adjacency };
}

/**
 * Main function
 */
function main() {
  console.log('Reading rhythms.csv...');
  const csvContent = readFileSync(csvPath, 'utf-8');

  console.log('Parsing rhythms...');
  const { rhythms4, rhythms8 } = parseRhythmsCSV(csvContent);
  console.log(`Found ${rhythms4.size} unique 4-hex rhythms`);
  console.log(`Found ${rhythms8.length} 8-hex rhythm pairs`);

  console.log('Building rhythm graph...');
  const graph = buildRhythmGraph(rhythms4, rhythms8);
  console.log(`Graph has ${graph.nodes.length} nodes`);

  // Count edges
  const totalEdges = graph.adjacency.reduce((sum, adj) => sum + adj.length, 0) / 2;
  console.log(`Graph has ${totalEdges} edges`);

  // Find connected components for debugging
  const visited = new Set();
  let components = 0;
  let isolatedNodes = 0;

  for (let i = 0; i < graph.nodes.length; i++) {
    if (!visited.has(i)) {
      components++;
      const stack = [i];
      let componentSize = 0;
      while (stack.length > 0) {
        const node = stack.pop();
        if (visited.has(node)) continue;
        visited.add(node);
        componentSize++;
        for (const neighbor of graph.adjacency[node]) {
          if (!visited.has(neighbor)) {
            stack.push(neighbor);
          }
        }
      }
      if (componentSize === 1 && graph.adjacency[i].length === 0) {
        isolatedNodes++;
      }
    }
  }
  console.log(`Graph has ${components} connected components (${isolatedNodes} isolated nodes)`);

  console.log(`Writing to ${outputPath}...`);
  writeFileSync(outputPath, JSON.stringify(graph, null, 2));
  console.log('Done!');
}

main();
