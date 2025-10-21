#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { config } from '../src/config';
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

async function runDemo(): Promise<void> {
  try {
    logger.info('🚀 Starting IoT Solar Simulator Demo');
    
    // Connect to database
    await connectDatabase();
    const prisma = getPrismaClient();
    
    // Step 1: Seed sites
    logger.info('📋 Step 1: Seeding sites...');
    await seedSites(prisma);
    
    // Step 2: Generate yesterday's data
    logger.info('⚡ Step 2: Generating yesterday\'s telemetry...');
    const yesterday = addDays(new Date(), -1);
    await generateDayData(prisma, yesterday);
    
    // Step 3: Show dashboard preview
    logger.info('📊 Step 3: Generating dashboard preview...');
    await showDashboardPreview(prisma);
    
    // Step 4: Demonstrate API calls
    logger.info('🌐 Step 4: Demonstrating API calls...');
    await demonstrateAPI();
    
    logger.info('✅ Demo completed successfully!');
    logger.info('🌐 Visit http://localhost:4200/dashboard to see the web interface');
    logger.info('📚 Check README.md for full API documentation');
    
  } catch (error) {
    logger.error('❌ Demo failed:', error);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

async function seedSites(prisma: PrismaClient): Promise<void> {
  for (const siteId of config.siteIds) {
    const configPath = path.join(__dirname, '../src/config/sites', `${siteId}.json`);
    
    if (!fs.existsSync(configPath)) {
      logger.warn(`Site config not found: ${configPath}`);
      continue;
    }
    
    const siteConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    await prisma.site.upsert({
      where: { id: siteId },
      update: {
        name: siteConfig.name,
        country: siteConfig.country,
        timezone: siteConfig.timezone,
        capacityDcKw: siteConfig.capacityDcKW,
        capacityAcKw: siteConfig.capacityAcKW,
        tiltDeg: siteConfig.tiltDeg,
        azimuthDeg: siteConfig.azimuthDeg,
        modules: siteConfig.modules,
        inverterEff: siteConfig.inverterEff,
        degradationPctPerYear: siteConfig.degradationPctPerYear,
        baselineKgPerKwh: siteConfig.baselineKgPerKwh,
        lat: siteConfig.lat,
        lon: siteConfig.lon,
        outageWindows: JSON.stringify(siteConfig.outageWindows),
        curtailmentPct: siteConfig.curtailmentPct,
      },
      create: {
        id: siteId,
        name: siteConfig.name,
        country: siteConfig.country,
        timezone: siteConfig.timezone,
        capacityDcKw: siteConfig.capacityDcKW,
        capacityAcKw: siteConfig.capacityAcKW,
        tiltDeg: siteConfig.tiltDeg,
        azimuthDeg: siteConfig.azimuthDeg,
        modules: siteConfig.modules,
        inverterEff: siteConfig.inverterEff,
        degradationPctPerYear: siteConfig.degradationPctPerYear,
        baselineKgPerKwh: siteConfig.baselineKgPerKwh,
        lat: siteConfig.lat,
        lon: siteConfig.lon,
        outageWindows: JSON.stringify(siteConfig.outageWindows),
        curtailmentPct: siteConfig.curtailmentPct,
      },
    });
    
    logger.info(`✅ Seeded site: ${siteId} (${siteConfig.name})`);
  }
}

async function generateDayData(prisma: PrismaClient, day: Date): Promise<void> {
  const aggregationService = new AggregationService();
  const digestGenerator = new DigestGenerator();
  const anchorClient = new RegistryAdapterClient();
  
  const dayUtc = getDayUtc(day);
  
  for (const siteId of config.siteIds) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      logger.warn(`Site not found: ${siteId}`);
      continue;
    }
    
    logger.info(`⚡ Generating data for site: ${siteId}`);
    
    try {
      // Generate telemetry
      const telemetryGenerator = new TelemetryGenerator(site as any, config.simSeed);
      const telemetry = await telemetryGenerator.generateDayTelemetry(day, 5);
      
      // Generate hourly summaries
      await aggregationService.generateHourlySummaries(siteId, day);
      
      // Generate daily digest
      const digest = await digestGenerator.generateAndStoreDigest(
        siteId,
        day,
        site as any,
        5
      );
      
      logger.info(`📊 Generated ${telemetry.length} telemetry records`);
      logger.info(`⚡ Daily energy: ${digest.energyKwh.toFixed(2)} kWh`);
      logger.info(`🌱 CO₂ avoided: ${digest.avoidedTco2e.toFixed(3)} tCO₂e`);
      logger.info(`🔗 Merkle root: ${digest.merkleRoot.substring(0, 16)}...`);
      
      // Anchor digest if enabled
      if (config.anchorEnabled) {
        logger.info(`🔗 Anchoring digest for ${siteId}...`);
        const anchorResult = await anchorClient.anchorDigestWithRetry(
          siteId,
          dayUtc,
          digest.merkleRoot
        );
        
        if (anchorResult.success) {
          await aggregationService.updateDigestAnchor(
            siteId,
            dayUtc,
            anchorResult.adapterTxId,
            anchorResult.txHash
          );
          logger.info(`✅ Digest anchored: ${anchorResult.txHash}`);
        } else {
          logger.warn(`⚠️ Failed to anchor digest: ${anchorResult.error}`);
        }
      }
      
    } catch (error) {
      logger.error(`❌ Failed to generate data for site ${siteId}:`, error);
    }
  }
}

async function showDashboardPreview(prisma: PrismaClient): Promise<void> {
  logger.info('📊 Dashboard Preview:');
  
  const sites = await prisma.site.findMany({
    select: {
      id: true,
      name: true,
      country: true,
      capacityAcKw: true,
      baselineKgPerKwh: true,
    },
  });
  
  for (const site of sites) {
    const latestDigest = await prisma.dailyDigest.findFirst({
      where: { siteId: site.id },
      orderBy: { dayUtc: 'desc' },
    });
    
    logger.info(`🏭 ${site.name} (${site.id})`);
    logger.info(`   📍 Country: ${site.country}`);
    logger.info(`   ⚡ Capacity: ${site.capacityAcKw} kW AC`);
    logger.info(`   🌱 Emission Factor: ${site.baselineKgPerKwh} kg CO₂e/kWh`);
    
    if (latestDigest) {
      logger.info(`   📊 Latest Digest: ${latestDigest.dayUtc}`);
      logger.info(`   ⚡ Energy: ${latestDigest.energyKwh.toFixed(2)} kWh`);
      logger.info(`   🌱 CO₂ Avoided: ${latestDigest.avoidedTco2e.toFixed(3)} tCO₂e`);
      logger.info(`   🔗 Anchored: ${latestDigest.anchorTxHash ? 'Yes' : 'No'}`);
    } else {
      logger.info(`   📊 No digests found`);
    }
    logger.info('');
  }
}

async function demonstrateAPI(): Promise<void> {
  logger.info('🌐 API Endpoints Available:');
  logger.info('   GET  /health                    - System health check');
  logger.info('   GET  /metrics                   - System metrics');
  logger.info('   GET  /sites                     - List all sites');
  logger.info('   GET  /sites/:id                  - Get site details');
  logger.info('   GET  /sites/:id/telemetry        - Get telemetry data');
  logger.info('   GET  /sites/:id/daily           - Get daily digests');
  logger.info('   POST /sites/:id/generate         - Generate telemetry');
  logger.info('   POST /sites/:id/anchor          - Anchor digest');
  logger.info('   GET  /sites/:id/preview/today   - Today\'s summary');
  logger.info('   GET  /dashboard                 - Web dashboard');
  logger.info('');
  
  logger.info('📝 Example API calls:');
  logger.info('   curl http://localhost:4200/health');
  logger.info('   curl http://localhost:4200/sites');
  logger.info('   curl http://localhost:4200/sites/PRJ001/telemetry');
  logger.info('   curl http://localhost:4200/sites/PRJ001/daily');
  logger.info('');
}

// Run if called directly
if (require.main === module) {
  runDemo();
}
