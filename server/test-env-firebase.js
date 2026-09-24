#!/usr/bin/env node

// Test script to check Firebase environment variable loading
require('dotenv').config();

console.log('=== Firebase Environment Variables Test ===');
console.log('Current working directory:', process.cwd());
console.log('.env file path:', require('path').join(process.cwd(), '.env'));
console.log('');

console.log('Firebase Environment Variables:');
console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID || 'NOT SET');
console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL || 'NOT SET');
console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? 'SET (hidden)' : 'NOT SET');
console.log('DISABLE_FIREBASE:', process.env.DISABLE_FIREBASE || 'NOT SET');
console.log('');

console.log('Configuration Status:');
const isConfigured = !!(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL);
console.log('Firebase configured:', isConfigured ? 'YES' : 'NO');

if (isConfigured) {
  console.log('\n✅ Firebase environment variables are properly loaded!');
} else {
  console.log('\n❌ Firebase environment variables are NOT loaded!');
  console.log('Please check:');
  console.log('1. The .env file exists in the server directory');
  console.log('2. The environment variables are properly set in the .env file');
  console.log('3. There are no typos in the variable names');
}