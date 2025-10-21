import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Environment configuration schema
const envSchema = z.object({
  PORT: z.string().transform(Number).default('4200'),
  DATABASE_URL: z.string().default('file:./sim.db'),
  SIM_SEED: z.string().transform(Number).default('42'),
  INTERVAL_SECONDS: z.string().transform(Number).default('60'),
  DEFAULT_INTERVAL_MINUTES: z.string().transform(Number).default('5'),
  ANCHOR_ENABLED: z.string().transform(val => val === 'true').default('true'),
  ADAPTER_API_URL: z.string().default('http://localhost:4100'),
  ADAPTER_API_KEY: z.string().optional(),
  SITE_IDS: z.string().default('PRJ001,PRJ002'),
  BASELINE_FACTOR_KG_PER_KWH_IN: z.string().transform(Number).default('0.708'),
  BASELINE_FACTOR_KG_PER_KWH_DEFAULT: z.string().transform(Number).default('0.82'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_PRETTY: z.string().transform(val => val === 'true').default('true'),
  MQTT_ENABLED: z.string().transform(val => val === 'true').default('false'),
  MQTT_BROKER_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

// Site configuration schema
export const siteConfigSchema = z.object({
  siteId: z.string(),
  name: z.string(),
  country: z.string(),
  timezone: z.string(),
  lat: z.number(),
  lon: z.number(),
  capacityDcKW: z.number(),
  capacityAcKW: z.number(),
  tiltDeg: z.number(),
  azimuthDeg: z.number(),
  modules: z.number(),
  inverterEff: z.number(),
  degradationPctPerYear: z.number().default(0.5),
  baselineKgPerKwh: z.number(),
  outageWindows: z.array(z.object({
    start: z.string(),
    end: z.string(),
    days: z.string(),
  })).default([]),
  curtailmentPct: z.number().default(0.0),
});

export type SiteConfig = z.infer<typeof siteConfigSchema>;

// Parse and validate environment
const env = envSchema.parse(process.env);

// Export configuration
export const config = {
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  simSeed: env.SIM_SEED,
  intervalSeconds: env.INTERVAL_SECONDS,
  defaultIntervalMinutes: env.DEFAULT_INTERVAL_MINUTES,
  anchorEnabled: env.ANCHOR_ENABLED,
  adapterApiUrl: env.ADAPTER_API_URL,
  adapterApiKey: env.ADAPTER_API_KEY,
  siteIds: env.SITE_IDS.split(',').map(id => id.trim()),
  baselineFactors: {
    india: env.BASELINE_FACTOR_KG_PER_KWH_IN,
    default: env.BASELINE_FACTOR_KG_PER_KWH_DEFAULT,
  },
  logging: {
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
  },
  mqtt: {
    enabled: env.MQTT_ENABLED,
    brokerUrl: env.MQTT_BROKER_URL,
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
  },
  nodeEnv: env.NODE_ENV,
} as const;

// Default emission factors by country
export const EMISSION_FACTORS = {
  IN: 0.708,  // India
  US: 0.386,  // USA average
  EU: 0.255,  // EU average
  CN: 0.581,  // China
  AU: 0.760,  // Australia
  BR: 0.120,  // Brazil
  CA: 0.130,  // Canada
  DE: 0.400,  // Germany
  FR: 0.050,  // France
  GB: 0.200,  // UK
  JP: 0.500,  // Japan
  KR: 0.450,  // South Korea
  MX: 0.450,  // Mexico
  RU: 0.350,  // Russia
  ZA: 0.900,  // South Africa
} as const;

export function getEmissionFactor(country: string): number {
  return EMISSION_FACTORS[country as keyof typeof EMISSION_FACTORS] || config.baselineFactors.default;
}

export function toTco2e(energyKwh: number, factorKgPerKwh: number): number {
  return (energyKwh * factorKgPerKwh) / 1000;
}
