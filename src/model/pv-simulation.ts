import { SiteConfig } from '../config';
import { DeterministicRNG, clamp, roundToDecimals } from '../util';

export interface WeatherConditions {
  poaIrrWm2: number;
  tempC: number;
  windMps: number;
}

export interface TelemetryData {
  tsUtc: string;
  poaIrrWm2: number;
  tempC: number;
  windMps: number;
  acPowerKw: number;
  acEnergyKwh: number;
  status: string;
}

export class PVSimulationModel {
  private rng: DeterministicRNG;
  private site: SiteConfig;

  constructor(site: SiteConfig, seed: number) {
    this.site = site;
    this.rng = new DeterministicRNG(seed);
  }

  /**
   * Calculate solar position and irradiance for given time and location
   */
  calculateIrradiance(date: Date): number {
    const lat = this.site.lat;
    const lon = this.site.lon;
    
    // Convert to radians
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
    
    // Calculate day of year
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    
    // Solar declination
    const declination = 23.45 * Math.sin((284 + dayOfYear) * Math.PI / 180) * Math.PI / 180;
    
    // Hour angle
    const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
    const hourAngle = (utcHours - 12) * 15 * Math.PI / 180;
    
    // Solar elevation angle
    const elevation = Math.asin(
      Math.sin(latRad) * Math.sin(declination) +
      Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle)
    );
    
    // Solar azimuth angle
    const azimuth = Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(latRad) - Math.tan(declination) * Math.cos(latRad)
    );
    
    // Check if sun is above horizon
    if (elevation <= 0) {
      return 0;
    }
    
    // Calculate plane-of-array irradiance
    const tiltRad = (this.site.tiltDeg * Math.PI) / 180;
    const azimuthRad = (this.site.azimuthDeg * Math.PI) / 180;
    
    const cosIncidence = Math.sin(elevation) * Math.cos(tiltRad) +
      Math.cos(elevation) * Math.sin(tiltRad) * Math.cos(azimuth - azimuthRad);
    
    // Extraterrestrial irradiance
    const solarConstant = 1367; // W/m²
    const earthSunDistance = 1 + 0.033 * Math.cos(2 * Math.PI * dayOfYear / 365);
    const extraterrestrialIrradiance = solarConstant * earthSunDistance * Math.sin(elevation);
    
    // Atmospheric transmittance (simplified)
    const airMass = 1 / Math.sin(elevation);
    const atmosphericTransmittance = Math.pow(0.7, Math.pow(airMass, 0.678));
    
    // Direct normal irradiance
    const dni = extraterrestrialIrradiance * atmosphericTransmittance;
    
    // Diffuse irradiance (simplified)
    const diffuseFraction = 0.1 + 0.3 * Math.exp(-dni / 200);
    const diffuseIrradiance = dni * diffuseFraction;
    
    // Total irradiance on horizontal surface
    const globalHorizontalIrradiance = dni * Math.sin(elevation) + diffuseIrradiance;
    
    // Plane-of-array irradiance
    const poaIrr = dni * Math.max(0, cosIncidence) + diffuseIrradiance * (1 + Math.cos(tiltRad)) / 2;
    
    // Add cloud cover variation (Perlin-like noise)
    const cloudVariation = this.calculateCloudVariation(date);
    const finalPoaIrr = Math.max(0, poaIrr * cloudVariation);
    
    return roundToDecimals(finalPoaIrr, 1);
  }

  /**
   * Calculate cloud cover variation using simplified Perlin-like noise
   */
  private calculateCloudVariation(date: Date): number {
    const timeOfDay = date.getUTCHours() + date.getUTCMinutes() / 60;
    const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / (24 * 60 * 60 * 1000));
    
    // Base cloud probability varies by season
    const seasonalVariation = 0.8 + 0.4 * Math.sin(2 * Math.PI * dayOfYear / 365);
    
    // Daily variation (more clouds in afternoon)
    const dailyVariation = 0.7 + 0.6 * Math.sin(Math.PI * (timeOfDay - 6) / 12);
    
    // Random cloud cover
    const randomFactor = this.rng.range(0.3, 1.2);
    
    return clamp(seasonalVariation * dailyVariation * randomFactor, 0.1, 1.0);
  }

  /**
   * Calculate ambient temperature
   */
  calculateTemperature(date: Date): number {
    const lat = this.site.lat;
    const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / (24 * 60 * 60 * 1000));
    const timeOfDay = date.getUTCHours() + date.getUTCMinutes() / 60;
    
    // Base temperature varies by latitude and season
    const baseTemp = 25 - (Math.abs(lat) - 30) * 0.5;
    const seasonalVariation = 10 * Math.sin(2 * Math.PI * (dayOfYear - 80) / 365);
    
    // Daily temperature cycle
    const dailyVariation = 8 * Math.sin(Math.PI * (timeOfDay - 6) / 12);
    
    // Random variation
    const randomVariation = this.rng.normal(0, 2);
    
    const tempC = baseTemp + seasonalVariation + dailyVariation + randomVariation;
    return roundToDecimals(clamp(tempC, -10, 50), 1);
  }

  /**
   * Calculate wind speed
   */
  calculateWindSpeed(date: Date): number {
    const timeOfDay = date.getUTCHours() + date.getUTCMinutes() / 60;
    
    // Wind typically stronger during day
    const dailyVariation = 2 + 3 * Math.sin(Math.PI * (timeOfDay - 6) / 12);
    
    // Random variation
    const randomVariation = this.rng.range(0, 5);
    
    const windMps = Math.max(0, dailyVariation + randomVariation);
    return roundToDecimals(windMps, 1);
  }

  /**
   * Calculate DC power from irradiance
   */
  calculateDcPower(poaIrrWm2: number, tempC: number): number {
    // Module efficiency (simplified)
    const moduleEfficiency = 0.20; // 20% typical efficiency
    
    // Temperature coefficient
    const tempCoeff = -0.004; // -0.4% per °C above 25°C
    const tempLoss = tempCoeff * (tempC - 25);
    
    // Module area (simplified calculation)
    const moduleArea = this.site.modules * 2; // ~2 m² per module
    
    // DC power calculation
    const dcPowerKw = (poaIrrWm2 * moduleArea * moduleEfficiency * (1 + tempLoss)) / 1000;
    
    return roundToDecimals(Math.max(0, dcPowerKw), 3);
  }

  /**
   * Calculate AC power from DC power
   */
  calculateAcPower(dcPowerKw: number): number {
    // Apply inverter efficiency
    const acPowerKw = dcPowerKw * this.site.inverterEff;
    
    // Apply AC capacity limit
    const limitedAcPowerKw = Math.min(acPowerKw, this.site.capacityAcKw);
    
    return roundToDecimals(limitedAcPowerKw, 3);
  }

  /**
   * Calculate energy from power and time interval
   */
  calculateEnergy(acPowerKw: number, intervalMinutes: number): number {
    const intervalHours = intervalMinutes / 60;
    const energyKwh = acPowerKw * intervalHours;
    return roundToDecimals(energyKwh, 3);
  }

  /**
   * Check for outages based on configured windows
   */
  checkOutage(date: Date): boolean {
    const timeOfDay = date.getUTCHours() + date.getUTCMinutes() / 60;
    const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
    
    for (const window of this.site.outageWindows) {
      const startHour = this.parseTime(window.start);
      const endHour = this.parseTime(window.end);
      
      // Check if current time is within outage window
      if (timeOfDay >= startHour && timeOfDay <= endHour) {
        // Check if current day matches outage days
        if (this.matchesDayPattern(dayOfWeek, window.days)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check for curtailment
   */
  checkCurtailment(): boolean {
    return this.rng.next() < this.site.curtailmentPct;
  }

  /**
   * Generate complete telemetry data for a given time
   */
  generateTelemetry(date: Date, intervalMinutes: number): TelemetryData {
    const poaIrrWm2 = this.calculateIrradiance(date);
    const tempC = this.calculateTemperature(date);
    const windMps = this.calculateWindSpeed(date);
    
    // Check for outages first
    const isOutage = this.checkOutage(date);
    const isCurtailed = !isOutage && this.checkCurtailment();
    
    let acPowerKw = 0;
    let status = 'OK';
    
    if (isOutage) {
      status = 'OUTAGE';
    } else if (isCurtailed) {
      status = 'CURTAILED';
    } else if (poaIrrWm2 > 0) {
      const dcPowerKw = this.calculateDcPower(poaIrrWm2, tempC);
      acPowerKw = this.calculateAcPower(dcPowerKw);
    }
    
    const acEnergyKwh = this.calculateEnergy(acPowerKw, intervalMinutes);
    
    return {
      tsUtc: date.toISOString(),
      poaIrrWm2,
      tempC,
      windMps,
      acPowerKw,
      acEnergyKwh,
      status,
    };
  }

  /**
   * Parse time string (HH:MM) to decimal hours
   */
  private parseTime(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours + minutes / 60;
  }

  /**
   * Check if day of week matches pattern
   */
  private matchesDayPattern(dayOfWeek: number, pattern: string): boolean {
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const currentDay = dayNames[dayOfWeek];
    
    // Simple pattern matching - can be extended for more complex patterns
    return pattern.includes(currentDay) || pattern === 'ALL';
  }
}
