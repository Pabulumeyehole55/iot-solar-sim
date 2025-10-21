import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { config } from '../config';
import { sha256 } from '../util';

export interface AnchorRequest {
  topic: string;
  hash: string;
  uri?: string;
}

export interface AnchorResponse {
  adapterTxId: string;
  txHash: string;
  blockNumber: number;
  success: boolean;
  error?: string;
}

export interface AnchorStatus {
  ok: boolean;
  error?: string;
}

export class RegistryAdapterClient {
  private client: AxiosInstance;
  private enabled: boolean;

  constructor() {
    this.enabled = config.anchorEnabled;
    
    this.client = axios.create({
      baseURL: config.adapterApiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'iot-solar-sim/1.0.0',
      },
    });

    // Add API key if provided
    if (config.adapterApiKey) {
      this.client.defaults.headers.common['x-app-key'] = config.adapterApiKey;
    }

    // Add request interceptor for HMAC signing if API key is provided
    if (config.adapterApiKey) {
      this.client.interceptors.request.use((config) => {
        if (config.data) {
          const body = JSON.stringify(config.data);
          const signature = this.generateHmacSignature(body);
          config.headers['x-app-sig'] = signature;
        }
        return config;
      });
    }
  }

  /**
   * Anchor a digest hash to the blockchain
   */
  async anchorDigest(
    siteId: string,
    dayUtc: string,
    merkleRoot: string,
    uri?: string
  ): Promise<AnchorResponse> {
    if (!this.enabled) {
      return {
        adapterTxId: '',
        txHash: '',
        blockNumber: 0,
        success: false,
        error: 'Anchoring is disabled',
      };
    }

    const topic = `IOT:${siteId}:${dayUtc}`;
    const hash = merkleRoot.startsWith('0x') ? merkleRoot : `0x${merkleRoot}`;

    const request: AnchorRequest = {
      topic,
      hash,
      uri,
    };

    try {
      const response: AxiosResponse<AnchorResponse> = await this.client.post(
        '/v1/anchor',
        request
      );

      return {
        adapterTxId: response.data.adapterTxId,
        txHash: response.data.txHash,
        blockNumber: response.data.blockNumber,
        success: true,
      };
    } catch (error) {
      console.error('Failed to anchor digest:', error);
      
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data?.error || error.message;
        return {
          adapterTxId: '',
          txHash: '',
          blockNumber: 0,
          success: false,
          error: errorMessage,
        };
      }

      return {
        adapterTxId: '',
        txHash: '',
        blockNumber: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check anchor status
   */
  async checkAnchorStatus(): Promise<AnchorStatus> {
    if (!this.enabled) {
      return { ok: false, error: 'Anchoring is disabled' };
    }

    try {
      const response = await this.client.get('/health');
      return { ok: response.status === 200 };
    } catch (error) {
      console.error('Failed to check anchor status:', error);
      
      if (axios.isAxiosError(error)) {
        return { 
          ok: false, 
          error: error.response?.data?.error || error.message 
        };
      }

      return { 
        ok: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Retry anchoring with exponential backoff
   */
  async anchorDigestWithRetry(
    siteId: string,
    dayUtc: string,
    merkleRoot: string,
    uri?: string,
    maxRetries: number = 3
  ): Promise<AnchorResponse> {
    let lastError: string | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.anchorDigest(siteId, dayUtc, merkleRoot, uri);
        
        if (result.success) {
          return result;
        }
        
        lastError = result.error;
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`Anchor attempt ${attempt} failed, retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`Anchor attempt ${attempt} failed, retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    return {
      adapterTxId: '',
      txHash: '',
      blockNumber: 0,
      success: false,
      error: `Failed after ${maxRetries} attempts: ${lastError}`,
    };
  }

  /**
   * Generate HMAC signature for request authentication
   */
  private generateHmacSignature(body: string): string {
    if (!config.adapterApiKey) {
      throw new Error('API key is required for HMAC signing');
    }

    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', config.adapterApiKey);
    hmac.update(body);
    return hmac.digest('hex');
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get client configuration
   */
  getConfig(): {
    enabled: boolean;
    baseUrl: string;
    hasApiKey: boolean;
  } {
    return {
      enabled: this.enabled,
      baseUrl: config.adapterApiUrl,
      hasApiKey: !!config.adapterApiKey,
    };
  }
}
