#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { config, siteConfigSchema } from '../src/config';
import { connectDatabase, disconnectDatabase, getPrismaClient } from '../src/db';
import { TelemetryGenerator } from '../src/ingest/telemetry-generator';
import { AggregationService } from '../src/aggregate';
import { DigestGenerator } from '../src/aggregate/digest-generator';
import { RegistryAdapterClient } from '../src/anchor/registry-adapter-client';
import { addDays, getDayUtc } from '../src/util';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

const logger = pino({
  level: config.logging.level,
  prettyPrint: config.logging.pretty,
});

async function seedSites(): Promise<void> {
  const prisma = getPrismaClient();
  
  logger.info('Seeding sites...');
  
  for (const siteId of config.siteIds) {
    const configPath = path.join(__dirname, '../src/config/sites', `${siteId}.json`);
    
    if (!fs.existsSync(configPath)) {
      logger.warn(`Site config not found: ${configPath}`);
      continue;
    }
    
    const siteConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Validate site config
    const validatedConfig = siteConfigSchema.parse(siteConfig);
    
    // Create or update site
    await prisma.site.upsert({
      where: { id: siteId },
      update: {
        name: validatedConfig.name,
        country: validatedConfig.country,
        timezone: validatedConfig.timezone,
        capacityDcKw: validatedConfig.capacityDcKW,
        capacityAcKw: validatedConfig.capacityAcKW,
        tiltDeg: validatedConfig.tiltDeg,
        azimuthDeg: validatedConfig.azimuthDeg,
        modules: validatedConfig.modules,
        inverterEff: validatedConfig.inverterEff,
        degradationPctPerYear: validatedConfig.degradationPctPerYear,
        baselineKgPerKwh: validatedConfig.baselineKgPerKwh,
        lat: validatedConfig.lat,
        lon: validatedConfig.lon,
        outageWindows: JSON.stringify(validatedConfig.outageWindows),
        curtailmentPct: validatedConfig.curtailmentPct,
      },
      create: {
        id: siteId,
        name: validatedConfig.name,
        country: validatedConfig.country,
        timezone: validatedConfig.timezone,
        capacityDcKw: validatedConfig.capacityDcKW,
        capacityAcKw: validatedConfig.capacityAcKW,
        tiltDeg: validatedConfig.tiltDeg,
        azimuthDeg: validatedConfig.azimuthDeg,
        modules: validatedConfig.modules,
        inverterEff: validatedConfig.inverterEff,
        degradationPctPerYear: validatedConfig.degradationPctPerYear,
        baselineKgPerKwh: validatedConfig.baselineKgPerKwh,
        lat: validatedConfig.lat,
        lon: validatedConfig.lon,
        outageWindows: JSON.stringify(validatedConfig.outageWindows),
        curtailmentPct: validatedConfig.curtailmentPct,
      },
    });
    
    logger.info(`Seeded site: ${siteId} (${validatedConfig.name})`);
  }
}

async function generateYesterdayData(): Promise<void> {
  const prisma = getPrismaClient();
  const aggregationService = new AggregationService();
  const digestGenerator = new DigestGenerator();
  const anchorClient = new RegistryAdapterClient();
  
  logger.info('Generating yesterday\'s data...');
  
  const yesterday = addDays(new Date(), -1);
  const yesterdayUtc = getDayUtc(yesterday);
  
  for (const siteId of config.siteIds) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      logger.warn(`Site not found: ${siteId}`);
      continue;
    }
    
    logger.info(`Generating data for site: ${siteId}`);
    
    try {
      // Generate telemetry
      const telemetryGenerator = new TelemetryGenerator(site as any, config.simSeed);
      const telemetry = await telemetryGenerator.generateDayTelemetry(yesterday, 5);
      
      // Generate hourly summaries
      await aggregationService.generateHourlySummaries(siteId, yesterday);
      
      // Generate daily digest
      const digest = await digestGenerator.generateAndStoreDigest(
        siteId,
        yesterday,
        site as any,
        5
      );
      
      logger.info(`Generated ${telemetry.length} telemetry records for ${siteId}`);
      logger.info(`Daily digest: ${digest.energyKwh} kWh, ${digest.avoidedTco2e} tCO2e avoided`);
      
      // Anchor digest if enabled
      if (config.anchorEnabled) {
        logger.info(`Anchoring digest for ${siteId}...`);
        const anchorResult = await anchorClient.anchorDigestWithRetry(
          siteId,
          yesterdayUtc,
          digest.merkleRoot
        );
        
        if (anchorResult.success) {
          await aggregationService.updateDigestAnchor(
            siteId,
            yesterdayUtc,
            anchorResult.adapterTxId,
            anchorResult.txHash
          );
          logger.info(`Digest anchored successfully: ${anchorResult.txHash}`);
        } else {
          logger.error(`Failed to anchor digest: ${anchorResult.error}`);
        }
      }
      
    } catch (error) {
      logger.error(`Failed to generate data for site ${siteId}:`, error);
    }
  }
}

async function main(): Promise<void> {
  try {
    logger.info('Starting seed process...');
    
    // Connect to database
    await connectDatabase();
    
    // Seed sites
    await seedSites();
    
    // Generate yesterday's data
    await generateYesterdayData();
    
    logger.info('Seed process completed successfully');
    
  } catch (error) {
    logger.error('Seed process failed:', error);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
