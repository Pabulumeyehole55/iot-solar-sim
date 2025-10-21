// Test setup file
import { PrismaClient } from '@prisma/client';

// Global test setup
beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'file:./test.db';
  process.env.LOG_LEVEL = 'error';
  process.env.LOG_PRETTY = 'false';
});

afterAll(async () => {
  // Cleanup
});

// Mock console methods to reduce noise in tests
const originalConsole = console;
beforeEach(() => {
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
});

afterEach(() => {
  global.console = originalConsole;
});
