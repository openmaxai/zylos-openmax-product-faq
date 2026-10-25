#!/usr/bin/env node
/**
 * Pre-upgrade hook for zylos-openmax-product-faq.
 *
 * Backs up config.json before the upgrade. Exit 1 would abort the upgrade;
 * this hook never needs to.
 */

import fs from 'node:fs';
import { dataPaths } from '../scripts/lib/paths.js';

const P = dataPaths();

console.log('[pre-upgrade] Running openmax-product-faq pre-upgrade checks...\n');

if (fs.existsSync(P.configPath)) {
  const backupPath = P.configPath + '.backup';
  fs.copyFileSync(P.configPath, backupPath);
  console.log('Config backed up to:', backupPath);
}

console.log('\n[pre-upgrade] Checks passed, proceeding with upgrade.');
