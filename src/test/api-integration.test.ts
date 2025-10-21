import { ApiServer } from '../src/api/server';
import { connectDatabase, disconnectDatabase } from '../src/db';
import { PrismaClient } from '@prisma/client';

describe('API Server Integration Tests', () => {
  let server: ApiServer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Connect to test database
    process.env.DATABASE_URL = 'file:./test.db';
    await connectDatabase();
    
    server = new ApiServer({ port: 0 }); // Use random port
    await server.initialize();
    await server.start();
    
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: 'file:./test.db',
        },
      },
    });
  });

  afterAll(async () => {
    await server.stop();
    await disconnectDatabase();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.dailyDigest.deleteMany();
    await prisma.hourlySummary.deleteMany();
    await prisma.telemetry.deleteMany();
    await prisma.site.deleteMany();
  });

  describe('Health Check', () => {
    test('should return health status', async () => {
      const response = await fetch('http://localhost:4200/health');
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data).toHaveProperty('ok');
      expect(data).toHaveProperty('db');
      expect(data).toHaveProperty('anchor');
    });
  });

  describe('Sites API', () => {
    test('should return empty sites list initially', async () => {
      const response = await fetch('http://localhost:4200/sites');
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.sites).toEqual([]);
    });

    test('should return 404 for non-existent site', async () => {
      const response = await fetch('http://localhost:4200/sites/NONEXISTENT');
      expect(response.status).toBe(404);
    });
  });

  describe('Telemetry API', () => {
    beforeEach(async () => {
      // Create a test site
      await prisma.site.create({
        data: {
          id: 'TEST001',
          name: 'Test Site',
          country: 'US',
          timezone: 'America/Los_Angeles',
          capacityDcKw: 1000,
          capacityAcKw: 800,
          tiltDeg: 30,
          azimuthDeg: 180,
          modules: 2000,
          inverterEff: 0.95,
          degradationPctPerYear: 0.5,
          baselineKgPerKwh: 0.386,
          lat: 34.05,
          lon: -118.24,
          outageWindows: '[]',
          curtailmentPct: 0.0,
        },
      });
    });

    test('should return telemetry data', async () => {
      const response = await fetch('http://localhost:4200/sites/TEST001/telemetry');
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data).toHaveProperty('siteId', 'TEST001');
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
    });

    test('should return 404 for non-existent site', async () => {
      const response = await fetch('http://localhost:4200/sites/NONEXISTENT/telemetry');
      expect(response.status).toBe(404);
    });
  });

  describe('Daily Digests API', () => {
    beforeEach(async () => {
      // Create a test site
      await prisma.site.create({
        data: {
          id: 'TEST001',
          name: 'Test Site',
          country: 'US',
          timezone: 'America/Los_Angeles',
          capacityDcKw: 1000,
          capacityAcKw: 800,
          tiltDeg: 30,
          azimuthDeg: 180,
          modules: 2000,
          inverterEff: 0.95,
          degradationPctPerYear: 0.5,
          baselineKgPerKwh: 0.386,
          lat: 34.05,
          lon: -118.24,
          outageWindows: '[]',
          curtailmentPct: 0.0,
        },
      });
    });

    test('should return daily digests', async () => {
      const response = await fetch('http://localhost:4200/sites/TEST001/daily');
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data).toHaveProperty('siteId', 'TEST001');
      expect(data).toHaveProperty('digests');
      expect(Array.isArray(data.digests)).toBe(true);
    });

    test('should return 404 for non-existent site', async () => {
      const response = await fetch('http://localhost:4200/sites/NONEXISTENT/daily');
      expect(response.status).toBe(404);
    });
  });

  describe('Generate Telemetry API', () => {
    beforeEach(async () => {
      // Create a test site
      await prisma.site.create({
        data: {
          id: 'TEST001',
          name: 'Test Site',
          country: 'US',
          timezone: 'America/Los_Angeles',
          capacityDcKw: 1000,
          capacityAcKw: 800,
          tiltDeg: 30,
          azimuthDeg: 180,
          modules: 2000,
          inverterEff: 0.95,
          degradationPctPerYear: 0.5,
          baselineKgPerKwh: 0.386,
          lat: 34.05,
          lon: -118.24,
          outageWindows: '[]',
          curtailmentPct: 0.0,
        },
      });
    });

    test('should generate telemetry for a day', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dayStr = yesterday.toISOString().split('T')[0];
      
      const response = await fetch(`http://localhost:4200/sites/TEST001/generate?day=${dayStr}`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data).toHaveProperty('siteId', 'TEST001');
      expect(data).toHaveProperty('day', dayStr);
      expect(data).toHaveProperty('telemetryCount');
      expect(data).toHaveProperty('digest');
      expect(data.telemetryCount).toBeGreaterThan(0);
    });

    test('should return 404 for non-existent site', async () => {
      const response = await fetch('http://localhost:4200/sites/NONEXISTENT/generate');
      expect(response.status).toBe(404);
    });
  });

  describe('Preview API', () => {
    beforeEach(async () => {
      // Create a test site
      await prisma.site.create({
        data: {
          id: 'TEST001',
          name: 'Test Site',
          country: 'US',
          timezone: 'America/Los_Angeles',
          capacityDcKw: 1000,
          capacityAcKw: 800,
          tiltDeg: 30,
          azimuthDeg: 180,
          modules: 2000,
          inverterEff: 0.95,
          degradationPctPerYear: 0.5,
          baselineKgPerKwh: 0.386,
          lat: 34.05,
          lon: -118.24,
          outageWindows: '[]',
          curtailmentPct: 0.0,
        },
      });
    });

    test('should return preview data', async () => {
      const response = await fetch('http://localhost:4200/sites/TEST001/preview/today');
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data).toHaveProperty('siteId', 'TEST001');
      expect(data).toHaveProperty('powerNow');
      expect(data).toHaveProperty('energyToday');
      expect(data).toHaveProperty('avoidedTco2eToday');
      expect(data).toHaveProperty('lastDigest');
    });

    test('should return 404 for non-existent site', async () => {
      const response = await fetch('http://localhost:4200/sites/NONEXISTENT/preview/today');
      expect(response.status).toBe(404);
    });
  });
});
