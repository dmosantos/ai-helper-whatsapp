#!/usr/bin/env node
// Remove o aviso "ExperimentalWarning: SQLite..." para não poluir o stderr.
process.removeAllListeners('warning');

import { register } from 'tsx/esm/api';

register();
await import('../src/cli.ts');
