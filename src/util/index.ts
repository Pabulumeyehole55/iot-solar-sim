import { createHash } from 'crypto';
import { config } from '../config';

// Deterministic RNG using xoshiro128**
export class DeterministicRNG {
  private state: [number, number, number, number];

  constructor(seed: number = config.simSeed) {
    // Initialize state from seed using a simple hash
    const hash = createHash('sha256').update(seed.toString()).digest();
    this.state = [
      hash.readUInt32LE(0),
      hash.readUInt32LE(4),
      hash.readUInt32LE(8),
      hash.readUInt32LE(12),
    ];
  }

  // Generate next random number (0 to 1)
  next(): number {
    const [a, b, c, d] = this.state;
    const t = b << 9;
    let r = a * 5;
    r = ((r << 7) | (r >>> 25)) * 9;
    this.state[0] = a;
    this.state[1] = b;
    this.state[2] = c;
    this.state[3] = d;
    return (r >>> 0) / 0x100000000;
  }

  // Generate random number in range [min, max)
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  // Generate random integer in range [min, max]
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  // Generate random boolean with given probability
  boolean(probability: number = 0.5): boolean {
    return this.next() < probability;
  }

  // Generate random choice from array
  choice<T>(array: T[]): T {
    return array[this.int(0, array.length - 1)];
  }

  // Generate random normal distribution (Box-Muller transform)
  normal(mean: number = 0, stdDev: number = 1): number {
    if (this._spare !== null) {
      const value = this._spare;
      this._spare = null;
      return value * stdDev + mean;
    }
    
    const u1 = this.next();
    const u2 = this.next();
    const mag = Math.sqrt(-2 * Math.log(u1));
    this._spare = mag * Math.sin(2 * Math.PI * u2);
    return mag * Math.cos(2 * Math.PI * u2) * stdDev + mean;
  }

  private _spare: number | null = null;
}

// Time utilities
export function formatUtc(date: Date): string {
  return date.toISOString();
}

export function parseUtc(utcString: string): Date {
  return new Date(utcString);
}

export function getDayUtc(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getHourUtc(date: Date): string {
  return date.toISOString().substring(0, 13) + ':00:00.000Z';
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

// Hashing utilities
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashTelemetryRow(
  siteId: string,
  tsUtc: string,
  acEnergyKwh: number,
  acPowerKw: number,
  poaIrrWm2: number,
  tempC: number,
  status: string
): string {
  // Use fixed precision for deterministic hashing
  const data = [
    siteId,
    tsUtc,
    acEnergyKwh.toFixed(3),
    acPowerKw.toFixed(3),
    poaIrrWm2.toFixed(1),
    tempC.toFixed(1),
    status,
  ].join('|');
  
  return sha256(data);
}

// Merkle tree implementation
export function buildMerkleRoot(hashes: string[]): string {
  if (hashes.length === 0) {
    return sha256('');
  }
  
  if (hashes.length === 1) {
    return hashes[0];
  }

  // Sort hashes lexicographically
  const sortedHashes = [...hashes].sort();
  
  // Build tree bottom-up
  let currentLevel = sortedHashes;
  
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1] || left; // Duplicate last hash if odd
      const combined = left + right;
      nextLevel.push(sha256(combined));
    }
    
    currentLevel = nextLevel;
  }
  
  return currentLevel[0];
}

// CSV utilities
export function escapeCsvValue(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatCsvRow(values: (string | number)[]): string {
  return values.map(escapeCsvValue).join(',');
}

// Numeric utilities
export function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
