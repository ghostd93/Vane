import OpenAI from 'openai';
import BaseImageGenerator, { GeneratedImage } from '../../base/image';

type OpenAIImageConfig = { apiKey: string; baseURL: string; model: string };

class OpenAIImageGenerator extends BaseImageGenerator<OpenAIImageConfig> {
  private client: OpenAI;

  constructor(config: OpenAIImageConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: 0,
      timeout: 300_000,
    });
  }

  async generate(prompt: string): Promise<GeneratedImage[]> {
    const startedAt = Date.now();
    console.info('[images] Calling image API', {
      baseURL: this.config.baseURL,
      model: this.config.model,
    });
    const response = await this.client.images.generate({
      model: this.config.model,
      prompt,
    });

    if (!response.data) {
      throw new Error('Image API returned no image data');
    }

    const images = response.data.map((image) => {
      if (image.b64_json) {
        return {
          url: `data:image/png;base64,${image.b64_json}`,
          revisedPrompt: image.revised_prompt,
        };
      }
      if (image.url) return { url: image.url, revisedPrompt: image.revised_prompt };
      throw new Error('Image API returned an image without a URL or base64 data');
    });

    console.info('[images] Image API returned successfully', {
      imageCount: images.length,
      durationMs: Date.now() - startedAt,
    });
    return images;
  }
}

export default OpenAIImageGenerator;
