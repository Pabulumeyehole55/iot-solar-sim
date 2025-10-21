import { PrismaClient } from '@prisma/client';
import { SiteConfig } from '../config';
import { PVSimulationModel, TelemetryData } from '../model/pv-simulation';
import { hashTelemetryRow, formatUtc, addMinutes, getDayUtc } from '../util';
import { getPrismaClient } from '../db';

export interface TelemetryGeneratorOptions {
  siteId: string;
  startDate: Date;
  endDate: Date;
  intervalMinutes: number;
  seed?: number;
}

export class TelemetryGenerator {
  private prisma: PrismaClient;
  private site: SiteConfig;
  private model: PVSimulationModel;

  constructor(site: SiteConfig, seed: number) {
    this.prisma = getPrismaClient();
    this.site = site;
    this.model = new PVSimulationModel(site, seed);
  }

  /**
   * Generate telemetry data for a time range
   */
  async generateTelemetry(options: TelemetryGeneratorOptions): Promise<TelemetryData[]> {
    const { startDate, endDate, intervalMinutes } = options;
    const telemetryData: TelemetryData[] = [];
    
    let currentDate = new Date(startDate);
    
    while (currentDate < endDate) {
      const data = this.model.generateTelemetry(currentDate, intervalMinutes);
      telemetryData.push(data);
      currentDate = addMinutes(currentDate, intervalMinutes);
    }
    
    return telemetryData;
  }

  /**
   * Store telemetry data in database
   */
  async storeTelemetry(telemetryData: TelemetryData[]): Promise<void> {
    const records = telemetryData.map(data => ({
      siteId: this.site.siteId,
      tsUtc: data.tsUtc,
      poaIrrWm2: data.poaIrrWm2,
      tempC: data.tempC,
      windMps: data.windMps,
      acPowerKw: data.acPowerKw,
      acEnergyKwh: data.acEnergyKwh,
      status: data.status,
      rowHash: hashTelemetryRow(
        this.site.siteId,
        data.tsUtc,
        data.acEnergyKwh,
        data.acPowerKw,
        data.poaIrrWm2,
        data.tempC,
        data.status
      ),
    }));

    // Use upsert to handle duplicates
    for (const record of records) {
      await this.prisma.telemetry.upsert({
        where: {
          siteId_tsUtc: {
            siteId: record.siteId,
            tsUtc: record.tsUtc,
          },
        },
        update: record,
        create: record,
      });
    }
  }

  /**
   * Generate and store telemetry for a complete day
   */
  async generateDayTelemetry(day: Date, intervalMinutes: number): Promise<TelemetryData[]> {
    const startOfDay = new Date(day);
    startOfDay.setUTCHours(0, 0, 0, 0);
    
    const endOfDay = new Date(day);
    endOfDay.setUTCHours(23, 59, 59, 999);
    
    const telemetryData = await this.generateTelemetry({
      siteId: this.site.siteId,
      startDate: startOfDay,
      endDate: endOfDay,
      intervalMinutes,
    });

    await this.storeTelemetry(telemetryData);
    return telemetryData;
  }

  /**
   * Generate telemetry for a date range
   */
  async generateRangeTelemetry(
    startDate: Date,
    endDate: Date,
    intervalMinutes: number
  ): Promise<TelemetryData[]> {
    const allTelemetry: TelemetryData[] = [];
    
    let currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dayTelemetry = await this.generateDayTelemetry(currentDate, intervalMinutes);
      allTelemetry.push(...dayTelemetry);
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    
    return allTelemetry;
  }

  /**
   * Get existing telemetry data for a site and time range
   */
  async getTelemetry(
    siteId: string,
    startDate: Date,
    endDate: Date,
    intervalMinutes?: number
  ): Promise<TelemetryData[]> {
    const where: any = {
      siteId,
      tsUtc: {
        gte: formatUtc(startDate),
        lte: formatUtc(endDate),
      },
    };

    const telemetry = await this.prisma.telemetry.findMany({
      where,
      orderBy: { tsUtc: 'asc' },
    });

    return telemetry.map(t => ({
      tsUtc: t.tsUtc,
      poaIrrWm2: t.poaIrrWm2,
      tempC: t.tempC,
      windMps: t.windMps,
      acPowerKw: t.acPowerKw,
      acEnergyKwh: t.acEnergyKwh,
      status: t.status,
    }));
  }

  /**
   * Check if telemetry exists for a specific day
   */
  async hasTelemetryForDay(siteId: string, day: Date): Promise<boolean> {
    const dayUtc = getDayUtc(day);
    const startOfDay = new Date(dayUtc + 'T00:00:00.000Z');
    const endOfDay = new Date(dayUtc + 'T23:59:59.999Z');

    const count = await this.prisma.telemetry.count({
      where: {
        siteId,
        tsUtc: {
          gte: formatUtc(startOfDay),
          lte: formatUtc(endOfDay),
        },
      },
    });

    return count > 0;
  }

  /**
   * Delete telemetry for a specific day (useful for regeneration)
   */
  async deleteTelemetryForDay(siteId: string, day: Date): Promise<void> {
    const dayUtc = getDayUtc(day);
    const startOfDay = new Date(dayUtc + 'T00:00:00.000Z');
    const endOfDay = new Date(dayUtc + 'T23:59:59.999Z');

    await this.prisma.telemetry.deleteMany({
      where: {
        siteId,
        tsUtc: {
          gte: formatUtc(startOfDay),
          lte: formatUtc(endOfDay),
        },
      },
    });
  }

  /**
   * Get latest telemetry data for a site
   */
  async getLatestTelemetry(siteId: string, limit: number = 100): Promise<TelemetryData[]> {
    const telemetry = await this.prisma.telemetry.findMany({
      where: { siteId },
      orderBy: { tsUtc: 'desc' },
      take: limit,
    });

    return telemetry.map(t => ({
      tsUtc: t.tsUtc,
      poaIrrWm2: t.poaIrrWm2,
      tempC: t.tempC,
      windMps: t.windMps,
      acPowerKw: t.acPowerKw,
      acEnergyKwh: t.acEnergyKwh,
      status: t.status,
    }));
  }

  /**
   * Get telemetry statistics for a day
   */
  async getDayStatistics(siteId: string, day: Date): Promise<{
    totalEnergy: number;
    maxPower: number;
    avgTemp: number;
    avgIrradiance: number;
    rowCount: number;
  }> {
    const dayUtc = getDayUtc(day);
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
    });

    if (telemetry.length === 0) {
      return {
        totalEnergy: 0,
        maxPower: 0,
        avgTemp: 0,
        avgIrradiance: 0,
        rowCount: 0,
      };
    }

    const totalEnergy = telemetry.reduce((sum, t) => sum + t.acEnergyKwh, 0);
    const maxPower = Math.max(...telemetry.map(t => t.acPowerKw));
    const avgTemp = telemetry.reduce((sum, t) => sum + t.tempC, 0) / telemetry.length;
    const avgIrradiance = telemetry.reduce((sum, t) => sum + t.poaIrrWm2, 0) / telemetry.length;

    return {
      totalEnergy,
      maxPower,
      avgTemp,
      avgIrradiance,
      rowCount: telemetry.length,
    };
  }
}
