import { getStore } from '@netlify/blobs';
import { createAPI } from '../../src/server/api.js';

export default async function handler(request) {
  const store = getStore({ name: 'form-workout', consistency: 'strong' });
  return createAPI({ store, env: process.env })(request);
}

export const config = { path: '/api/*' };
