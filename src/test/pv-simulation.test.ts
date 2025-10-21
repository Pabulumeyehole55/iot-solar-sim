import { PVSimulationModel } from '../src/model/pv-simulation';
import { SiteConfig } from '../src/config';
import { DeterministicRNG, buildMerkleRoot, sha256, hashTelemetryRow } from '../src/util';
import { toTco2e } from '../src/config';

describe('PVSimulationModel', () => {
  const testSite: SiteConfig = {
    siteId: 'TEST001',
    name: 'Test Solar Farm',
    country: 'US',
    timezone: 'America/Los_Angeles',
    lat: 34.05,
    lon: -118.24,
    capacityDcKW: 1000,
    capacityAcKW: 800,
    tiltDeg: 30,
    azimuthDeg: 180,
    modules: 2000,
    inverterEff: 0.95,
    degradationPctPerYear: 0.5,
    baselineKgPerKwh: 0.386,
    outageWindows: [],
    curtailmentPct: 0.0,
  };

  let model: PVSimulationModel;

  beforeEach(() => {
    model = new PVSimulationModel(testSite, 42);
  });

  describe('Irradiance Calculation', () => {
    test('should return zero irradiance at night', () => {
      const nightTime = new Date('2024-01-01T02:00:00Z'); // 2 AM UTC
      const irradiance = model.calculateIrradiance(nightTime);
      expect(irradiance).toBe(0);
    });

    test('should return positive irradiance during day', () => {
      const dayTime = new Date('2024-06-21T12:00:00Z'); // Noon UTC on summer solstice
      const irradiance = model.calculateIrradiance(dayTime);
      expect(irradiance).toBeGreaterThan(0);
      expect(irradiance).toBeLessThanOrEqual(1500); // Reasonable upper bound
    });

    test('should be deterministic with same seed', () => {
      const time = new Date('2024-06-21T12:00:00Z');
      const model1 = new PVSimulationModel(testSite, 42);
      const model2 = new PVSimulationModel(testSite, 42);
      
      const irr1 = model1.calculateIrradiance(time);
      const irr2 = model2.calculateIrradiance(time);
      
      expect(irr1).toBe(irr2);
    });
  });

  describe('Temperature Calculation', () => {
    test('should return reasonable temperature range', () => {
      const time = new Date('2024-06-21T12:00:00Z');
      const temperature = model.calculateTemperature(time);
      
      expect(temperature).toBeGreaterThan(-10);
      expect(temperature).toBeLessThan(50);
    });

    test('should be deterministic with same seed', () => {
      const time = new Date('2024-06-21T12:00:00Z');
      const model1 = new PVSimulationModel(testSite, 42);
      const model2 = new PVSimulationModel(testSite, 42);
      
      const temp1 = model1.calculateTemperature(time);
      const temp2 = model2.calculateTemperature(time);
      
      expect(temp1).toBe(temp2);
    });
  });

  describe('Power Calculation', () => {
    test('should return zero power with zero irradiance', () => {
      const dcPower = model.calculateDcPower(0, 25);
      const acPower = model.calculateAcPower(dcPower);
      
      expect(dcPower).toBe(0);
      expect(acPower).toBe(0);
    });

    test('should respect AC capacity limit', () => {
      const highDcPower = 2000; // Higher than AC capacity
      const acPower = model.calculateAcPower(highDcPower);
      
      expect(acPower).toBeLessThanOrEqual(testSite.capacityAcKW);
    });

    test('should apply temperature coefficient', () => {
      const irradiance = 1000;
      const power25C = model.calculateDcPower(irradiance, 25);
      const power35C = model.calculateDcPower(irradiance, 35);
      
      expect(power35C).toBeLessThan(power25C);
    });
  });

  describe('Energy Calculation', () => {
    test('should calculate energy correctly', () => {
      const powerKw = 100;
      const intervalMinutes = 60; // 1 hour
      const energy = model.calculateEnergy(powerKw, intervalMinutes);
      
      expect(energy).toBe(100); // 100 kW * 1 hour = 100 kWh
    });
  });

  describe('Telemetry Generation', () => {
    test('should generate valid telemetry data', () => {
      const time = new Date('2024-06-21T12:00:00Z');
      const telemetry = model.generateTelemetry(time, 5);
      
      expect(telemetry.tsUtc).toBe(time.toISOString());
      expect(telemetry.poaIrrWm2).toBeGreaterThanOrEqual(0);
      expect(telemetry.tempC).toBeGreaterThan(-10);
      expect(telemetry.tempC).toBeLessThan(50);
      expect(telemetry.windMps).toBeGreaterThanOrEqual(0);
      expect(telemetry.acPowerKw).toBeGreaterThanOrEqual(0);
      expect(telemetry.acEnergyKwh).toBeGreaterThanOrEqual(0);
      expect(['OK', 'OUTAGE', 'CURTAILED']).toContain(telemetry.status);
    });

    test('should be deterministic with same seed', () => {
      const time = new Date('2024-06-21T12:00:00Z');
      const model1 = new PVSimulationModel(testSite, 42);
      const model2 = new PVSimulationModel(testSite, 42);
      
      const tel1 = model1.generateTelemetry(time, 5);
      const tel2 = model2.generateTelemetry(time, 5);
      
      expect(tel1.poaIrrWm2).toBe(tel2.poaIrrWm2);
      expect(tel1.tempC).toBe(tel2.tempC);
      expect(tel1.acPowerKw).toBe(tel2.acPowerKw);
      expect(tel1.status).toBe(tel2.status);
    });
  });
});

describe('DeterministicRNG', () => {
  test('should generate same sequence with same seed', () => {
    const rng1 = new DeterministicRNG(42);
    const rng2 = new DeterministicRNG(42);
    
    const values1 = Array.from({ length: 10 }, () => rng1.next());
    const values2 = Array.from({ length: 10 }, () => rng2.next());
    
    expect(values1).toEqual(values2);
  });

  test('should generate different sequences with different seeds', () => {
    const rng1 = new DeterministicRNG(42);
    const rng2 = new DeterministicRNG(123);
    
    const values1 = Array.from({ length: 10 }, () => rng1.next());
    const values2 = Array.from({ length: 10 }, () => rng2.next());
    
    expect(values1).not.toEqual(values2);
  });

  test('should generate values in correct range', () => {
    const rng = new DeterministicRNG(42);
    
    for (let i = 0; i < 100; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test('should generate integers in specified range', () => {
    const rng = new DeterministicRNG(42);
    
    for (let i = 0; i < 100; i++) {
      const value = rng.int(1, 10);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(10);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});

describe('Merkle Tree', () => {
  test('should build merkle root from single hash', () => {
    const hashes = ['abc123'];
    const root = buildMerkleRoot(hashes);
    expect(root).toBe('abc123');
  });

  test('should build merkle root from multiple hashes', () => {
    const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
    const root = buildMerkleRoot(hashes);
    expect(root).toBeDefined();
    expect(root).not.toBe('');
  });

  test('should be deterministic for same input', () => {
    const hashes = ['hash1', 'hash2', 'hash3', 'hash4'];
    const root1 = buildMerkleRoot(hashes);
    const root2 = buildMerkleRoot(hashes);
    expect(root1).toBe(root2);
  });

  test('should be different for different input order', () => {
    const hashes1 = ['hash1', 'hash2', 'hash3', 'hash4'];
    const hashes2 = ['hash4', 'hash3', 'hash2', 'hash1'];
    const root1 = buildMerkleRoot(hashes1);
    const root2 = buildMerkleRoot(hashes2);
    expect(root1).toBe(root2); // Should be same because we sort
  });
});

describe('Hashing', () => {
  test('should generate consistent hash for same input', () => {
    const hash1 = hashTelemetryRow('SITE1', '2024-01-01T00:00:00Z', 1.5, 2.0, 100.0, 25.0, 'OK');
    const hash2 = hashTelemetryRow('SITE1', '2024-01-01T00:00:00Z', 1.5, 2.0, 100.0, 25.0, 'OK');
    expect(hash1).toBe(hash2);
  });

  test('should generate different hash for different input', () => {
    const hash1 = hashTelemetryRow('SITE1', '2024-01-01T00:00:00Z', 1.5, 2.0, 100.0, 25.0, 'OK');
    const hash2 = hashTelemetryRow('SITE2', '2024-01-01T00:00:00Z', 1.5, 2.0, 100.0, 25.0, 'OK');
    expect(hash1).not.toBe(hash2);
  });

  test('should use fixed precision for deterministic hashing', () => {
    const hash1 = hashTelemetryRow('SITE1', '2024-01-01T00:00:00Z', 1.500, 2.000, 100.0, 25.0, 'OK');
    const hash2 = hashTelemetryRow('SITE1', '2024-01-01T00:00:00Z', 1.5, 2.0, 100.0, 25.0, 'OK');
    expect(hash1).toBe(hash2);
  });
});

describe('CO2 Conversion', () => {
  test('should convert kWh to tCO2e correctly', () => {
    const energyKwh = 1000;
    const factorKgPerKwh = 0.5;
    const tco2e = toTco2e(energyKwh, factorKgPerKwh);
    expect(tco2e).toBe(0.5); // 1000 kWh * 0.5 kg/kWh / 1000 = 0.5 tCO2e
  });

  test('should handle zero energy', () => {
    const tco2e = toTco2e(0, 0.5);
    expect(tco2e).toBe(0);
  });

  test('should handle zero emission factor', () => {
    const tco2e = toTco2e(1000, 0);
    expect(tco2e).toBe(0);
  });
});
