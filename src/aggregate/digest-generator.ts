import { PrismaClient } from '@prisma/client';
import { SiteConfig } from '../config';
import { getPrismaClient } from '../db';
import { formatUtc, getDayUtc, sha256, buildMerkleRoot, formatCsvRow, roundToDecimals } from '../util';
import { AggregationService, DailyDigest } from '../aggregate';

export interface DigestArtifact {
  json: string;
  csv: string;
  merkleRoot: string;
}

export interface DigestJson {
  siteId: string;
  day: string;
  rows: number;
  energyKWh: number;
  avoidedTCO2e: number;
  merkleRoot: string;
  hashAlgo: string;
  interval: string;
  factorKgPerKWh: number;
  version: string;
}

export class DigestGenerator {
  private prisma: PrismaClient;
  private aggregationService: AggregationService;

  constructor() {
    this.prisma = getPrismaClient();
    this.aggregationService = new AggregationService();
  }

  /**
   * Generate complete digest artifacts (JSON + CSV + Merkle root) for a day
   */
  async generateDigestArtifacts(
    siteId: string,
    day: Date,
    site: SiteConfig,
    intervalMinutes: number = 5
  ): Promise<DigestArtifact> {
    const dayUtc = getDayUtc(day);
    const startOfDay = new Date(dayUtc + 'T00:00:00.000Z');
    const endOfDay = new Date(dayUtc + 'T23:59:59.999Z');

    // Get all telemetry for the day
    const telemetry = await this.prisma.telemetry.findMany({
      where: {
        siteId,
        tsUtc: {
          gte: formatUtc(startOfDay),
          lte: formatUtc(endOfDay),
        },
      },
      orderBy: { tsUtc: 'asc' },
    });

    if (telemetry.length === 0) {
      throw new Error(`No telemetry data found for site ${siteId} on ${dayUtc}`);
    }

    // Calculate daily totals
    const energyKwh = telemetry.reduce((sum, t) => sum + t.acEnergyKwh, 0);
    const avoidedTco2e = (energyKwh * site.baselineKgPerKwh) / 1000;

    // Generate Merkle root from row hashes
    const rowHashes = telemetry.map(t => t.rowHash);
    const merkleRoot = buildMerkleRoot(rowHashes);

    // Generate JSON digest
    const digestJson: DigestJson = {
      siteId,
      day: dayUtc,
      rows: telemetry.length,
      energyKWh: roundToDecimals(energyKwh, 3),
      avoidedTCO2e: roundToDecimals(avoidedTco2e, 3),
      merkleRoot: `0x${merkleRoot}`,
      hashAlgo: 'sha256',
      interval: `${intervalMinutes}m`,
      factorKgPerKWh: site.baselineKgPerKwh,
      version: '1.0.0',
    };

    const jsonString = JSON.stringify(digestJson, null, 2);

    // Generate CSV
    const csvHeaders = [
      'timestamp_utc',
      'ac_power_kw',
      'ac_energy_kwh',
      'poa_irradiance_wm2',
      'temperature_c',
      'wind_speed_mps',
      'status',
      'row_hash',
    ];

    const csvRows = telemetry.map(t => [
      t.tsUtc,
      t.acPowerKw.toFixed(3),
      t.acEnergyKwh.toFixed(3),
      t.poaIrrWm2.toFixed(1),
      t.tempC.toFixed(1),
      t.windMps.toFixed(1),
      t.status,
      t.rowHash,
    ]);

    const csvString = [
      formatCsvRow(csvHeaders),
      ...csvRows.map(row => formatCsvRow(row)),
    ].join('\n');

    return {
      json: jsonString,
      csv: csvString,
      merkleRoot: `0x${merkleRoot}`,
    };
  }

  /**
   * Generate and store daily digest
   */
  async generateAndStoreDigest(
    siteId: string,
    day: Date,
    site: SiteConfig,
    intervalMinutes: number = 5
  ): Promise<DailyDigest> {
    // Generate digest artifacts
    const artifacts = await this.generateDigestArtifacts(siteId, day, site, intervalMinutes);
    
    // Parse JSON to get values
    const digestJson: DigestJson = JSON.parse(artifacts.json);
    
    // Create digest record
    const digest: DailyDigest = {
      siteId,
      dayUtc: digestJson.day,
      energyKwh: digestJson.energyKWh,
      avoidedTco2e: digestJson.avoidedTCO2e,
      rows: digestJson.rows,
      merkleRoot: digestJson.merkleRoot,
      createdAt: new Date(),
    };

    // Store in database
    await this.prisma.dailyDigest.upsert({
      where: {
        siteId_dayUtc: {
          siteId: digest.siteId,
          dayUtc: digest.dayUtc,
        },
      },
      update: digest,
      create: digest,
    });

    return digest;
  }

  /**
   * Verify digest integrity by recalculating Merkle root
   */
  async verifyDigestIntegrity(siteId: string, day: Date): Promise<boolean> {
    const dayUtc = getDayUtc(day);
    
    // Get stored digest
    const storedDigest = await this.prisma.dailyDigest.findUnique({
      where: {
        siteId_dayUtc: {
          siteId,
          dayUtc,
        },
      },
    });

    if (!storedDigest) {
      return false;
    }

    // Get telemetry data
    const startOfDay = new Date(dayUtc + 'T00:00:00.000Z');
    const endOfDay = new Date(dayUtc + 'T23:59:59.999Z');

    const telemetry = await this.prisma.telemetry.findMany({
      where: {
        siteId,
        tsUtc: {
          gte: formatUtc(startOfDay),
          lte: formatUtc(endOfDay),
        },
      },
      orderBy: { tsUtc: 'asc' },
    });

    if (telemetry.length !== storedDigest.rows) {
      return false;
    }

    // Recalculate Merkle root
    const rowHashes = telemetry.map(t => t.rowHash);
    const calculatedMerkleRoot = buildMerkleRoot(rowHashes);
    const expectedMerkleRoot = storedDigest.merkleRoot.replace('0x', '');

    return calculatedMerkleRoot === expectedMerkleRoot;
  }

  /**
   * Get digest artifacts for a specific day
   */
  async getDigestArtifacts(siteId: string, day: Date): Promise<DigestArtifact | null> {
    const dayUtc = getDayUtc(day);
    
    // Get stored digest
    const digest = await this.prisma.dailyDigest.findUnique({
      where: {
        siteId_dayUtc: {
          siteId,
          dayUtc,
        },
      },
    });

    if (!digest) {
      return null;
    }

    // Get site configuration
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
    });

    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    // Get telemetry data
    const startOfDay = new Date(dayUtc + 'T00:00:00.000Z');
    const endOfDay = new Date(dayUtc + 'T23:59:59.999Z');

    const telemetry = await this.prisma.telemetry.findMany({
      where: {
        siteId,
        tsUtc: {
          gte: formatUtc(startOfDay),
          lte: formatUtc(endOfDay),
        },
      },
      orderBy: { tsUtc: 'asc' },
    });

    // Generate JSON digest
    const digestJson: DigestJson = {
      siteId,
      day: dayUtc,
      rows: digest.rows,
      energyKWh: digest.energyKwh,
      avoidedTCO2e: digest.avoidedTco2e,
      merkleRoot: digest.merkleRoot,
      hashAlgo: 'sha256',
      interval: '5m',
      factorKgPerKwh: site.baselineKgPerKwh,
      version: '1.0.0',
    };

    const jsonString = JSON.stringify(digestJson, null, 2);

    // Generate CSV
    const csvHeaders = [
      'timestamp_utc',
      'ac_power_kw',
      'ac_energy_kwh',
      'poa_irradiance_wm2',
      'temperature_c',
      'wind_speed_mps',
      'status',
      'row_hash',
    ];

    const csvRows = telemetry.map(t => [
      t.tsUtc,
      t.acPowerKw.toFixed(3),
      t.acEnergyKwh.toFixed(3),
      t.poaIrrWm2.toFixed(1),
      t.tempC.toFixed(1),
      t.windMps.toFixed(1),
      t.status,
      t.rowHash,
    ]);

    const csvString = [
      formatCsvRow(csvHeaders),
      ...csvRows.map(row => formatCsvRow(row)),
    ].join('\n');

    return {
      json: jsonString,
      csv: csvString,
      merkleRoot: digest.merkleRoot,
    };
  }

  /**
   * Get digest statistics for multiple sites
   */
  async getMultiSiteDigestStatistics(siteIds: string[], days: number = 30): Promise<{
    [siteId: string]: {
      totalEnergy: number;
      totalAvoidedTco2e: number;
      digestCount: number;
      lastDigestDate: string | null;
    };
  }> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);

    const digests = await this.prisma.dailyDigest.findMany({
      where: {
        siteId: { in: siteIds },
        dayUtc: {
          gte: getDayUtc(startDate),
          lte: getDayUtc(endDate),
        },
      },
      orderBy: { dayUtc: 'desc' },
    });

    const statistics: { [siteId: string]: any } = {};

    for (const siteId of siteIds) {
      const siteDigests = digests.filter(d => d.siteId === siteId);
      
      const totalEnergy = siteDigests.reduce((sum, d) => sum + d.energyKwh, 0);
      const totalAvoidedTco2e = siteDigests.reduce((sum, d) => sum + d.avoidedTco2e, 0);
      const lastDigestDate = siteDigests.length > 0 ? siteDigests[0].dayUtc : null;

      statistics[siteId] = {
        totalEnergy: roundToDecimals(totalEnergy, 3),
        totalAvoidedTco2e: roundToDecimals(totalAvoidedTco2e, 3),
        digestCount: siteDigests.length,
        lastDigestDate,
      };
    }

    return statistics;
  }
}
