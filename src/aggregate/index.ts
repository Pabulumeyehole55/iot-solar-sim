import { PrismaClient } from '@prisma/client';
import { SiteConfig, toTco2e } from '../config';
import { getPrismaClient } from '../db';
import { formatUtc, getHourUtc, getDayUtc, roundToDecimals } from '../util';

export interface HourlySummary {
  hourUtc: string;
  siteId: string;
  energyKwh: number;
  maxPowerKw: number;
  avgTempC: number;
  avgIrrWm2: number;
}

export interface DailyDigest {
  siteId: string;
  dayUtc: string;
  energyKwh: number;
  avoidedTco2e: number;
  rows: number;
  merkleRoot: string;
  csvCid?: string;
  jsonCid?: string;
  anchorAdapterTxId?: string;
  anchorTxHash?: string;
  createdAt: Date;
}

export class AggregationService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Generate hourly summaries for a specific day
   */
  async generateHourlySummaries(siteId: string, day: Date): Promise<HourlySummary[]> {
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

    // Group by hour
    const hourlyData = new Map<string, typeof telemetry>();
    
    for (const record of telemetry) {
      const hourUtc = getHourUtc(new Date(record.tsUtc));
      if (!hourlyData.has(hourUtc)) {
        hourlyData.set(hourUtc, []);
      }
      hourlyData.get(hourUtc)!.push(record);
    }

    // Calculate summaries for each hour
    const summaries: HourlySummary[] = [];
    
    for (const [hourUtc, hourTelemetry] of hourlyData) {
      const energyKwh = hourTelemetry.reduce((sum, t) => sum + t.acEnergyKwh, 0);
      const maxPowerKw = Math.max(...hourTelemetry.map(t => t.acPowerKw));
      const avgTempC = hourTelemetry.reduce((sum, t) => sum + t.tempC, 0) / hourTelemetry.length;
      const avgIrrWm2 = hourTelemetry.reduce((sum, t) => sum + t.poaIrrWm2, 0) / hourTelemetry.length;

      summaries.push({
        hourUtc,
        siteId,
        energyKwh: roundToDecimals(energyKwh, 3),
        maxPowerKw: roundToDecimals(maxPowerKw, 3),
        avgTempC: roundToDecimals(avgTempC, 1),
        avgIrrWm2: roundToDecimals(avgIrrWm2, 1),
      });
    }

    // Store summaries in database
    for (const summary of summaries) {
      await this.prisma.hourlySummary.upsert({
        where: { hourUtc: summary.hourUtc },
        update: summary,
        create: summary,
      });
    }

    return summaries;
  }

  /**
   * Generate daily digest for a specific day
   */
  async generateDailyDigest(siteId: string, day: Date, site: SiteConfig): Promise<DailyDigest> {
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
    const avoidedTco2e = toTco2e(energyKwh, site.baselineKgPerKwh);

    // Generate Merkle root from row hashes
    const rowHashes = telemetry.map(t => t.rowHash);
    const merkleRoot = await this.buildMerkleRoot(rowHashes);

    const digest: DailyDigest = {
      siteId,
      dayUtc,
      energyKwh: roundToDecimals(energyKwh, 3),
      avoidedTco2e: roundToDecimals(avoidedTco2e, 3),
      rows: telemetry.length,
      merkleRoot,
      createdAt: new Date(),
    };

    // Store digest in database
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
   * Build Merkle root from sorted row hashes
   */
  private async buildMerkleRoot(hashes: string[]): Promise<string> {
    if (hashes.length === 0) {
      return '';
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
        nextLevel.push(await this.sha256(combined));
      }
      
      currentLevel = nextLevel;
    }
    
    return currentLevel[0];
  }

  /**
   * SHA-256 hash function
   */
  private async sha256(data: string): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Get daily digest for a specific day
   */
  async getDailyDigest(siteId: string, day: Date): Promise<DailyDigest | null> {
    const dayUtc = getDayUtc(day);
    
    const digest = await this.prisma.dailyDigest.findUnique({
      where: {
        siteId_dayUtc: {
          siteId,
          dayUtc,
        },
      },
    });

    return digest;
  }

  /**
   * Get daily digests for a date range
   */
  async getDailyDigests(
    siteId: string,
    startDate: Date,
    endDate: Date
  ): Promise<DailyDigest[]> {
    const startDayUtc = getDayUtc(startDate);
    const endDayUtc = getDayUtc(endDate);

    const digests = await this.prisma.dailyDigest.findMany({
      where: {
        siteId,
        dayUtc: {
          gte: startDayUtc,
          lte: endDayUtc,
        },
      },
      orderBy: { dayUtc: 'desc' },
    });

    return digests;
  }

  /**
   * Get hourly summaries for a date range
   */
  async getHourlySummaries(
    siteId: string,
    startDate: Date,
    endDate: Date
  ): Promise<HourlySummary[]> {
    const startHourUtc = getHourUtc(startDate);
    const endHourUtc = getHourUtc(endDate);

    const summaries = await this.prisma.hourlySummary.findMany({
      where: {
        siteId,
        hourUtc: {
          gte: startHourUtc,
          lte: endHourUtc,
        },
      },
      orderBy: { hourUtc: 'desc' },
    });

    return summaries;
  }

  /**
   * Get latest daily digest for a site
   */
  async getLatestDailyDigest(siteId: string): Promise<DailyDigest | null> {
    const digest = await this.prisma.dailyDigest.findFirst({
      where: { siteId },
      orderBy: { dayUtc: 'desc' },
    });

    return digest;
  }

  /**
   * Get digest statistics for a site
   */
  async getDigestStatistics(siteId: string, days: number = 30): Promise<{
    totalEnergy: number;
    totalAvoidedTco2e: number;
    digestCount: number;
    lastDigestDate: string | null;
  }> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);

    const digests = await this.prisma.dailyDigest.findMany({
      where: {
        siteId,
        dayUtc: {
          gte: getDayUtc(startDate),
          lte: getDayUtc(endDate),
        },
      },
      orderBy: { dayUtc: 'desc' },
    });

    const totalEnergy = digests.reduce((sum, d) => sum + d.energyKwh, 0);
    const totalAvoidedTco2e = digests.reduce((sum, d) => sum + d.avoidedTco2e, 0);
    const lastDigestDate = digests.length > 0 ? digests[0].dayUtc : null;

    return {
      totalEnergy: roundToDecimals(totalEnergy, 3),
      totalAvoidedTco2e: roundToDecimals(totalAvoidedTco2e, 3),
      digestCount: digests.length,
      lastDigestDate,
    };
  }

  /**
   * Update digest with anchor information
   */
  async updateDigestAnchor(
    siteId: string,
    dayUtc: string,
    anchorAdapterTxId: string,
    anchorTxHash: string
  ): Promise<void> {
    await this.prisma.dailyDigest.update({
      where: {
        siteId_dayUtc: {
          siteId,
          dayUtc,
        },
      },
      data: {
        anchorAdapterTxId,
        anchorTxHash,
      },
    });
  }
}
