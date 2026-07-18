import { UIConfigField } from '@/lib/config/types';
import { getConfiguredModelProviderById } from '@/lib/config/serverRegistry';
import BaseEmbedding from '../../base/embedding';
import BaseImageGenerator from '../../base/image';
import BaseLLM from '../../base/llm';
import BaseModelProvider from '../../base/provider';
import { Model, ModelList, ProviderMetadata } from '../../types';
import OpenAIImageGenerator from './openaiImageGenerator';

type OpenAIImagesConfig = {
  apiKey: string;
  baseURL: string;
};

const defaultImageModels: Model[] = [
  { name: 'GPT Image 1', key: 'gpt-image-1' },
  { name: 'DALL-E 3', key: 'dall-e-3' },
  { name: 'DALL-E 2', key: 'dall-e-2' },
];

const providerConfigFields: UIConfigField[] = [
  {
    type: 'password', name: 'API Key', key: 'apiKey', required: true,
    description: 'API key for the OpenAI-compatible images API',
    placeholder: 'API key', scope: 'server',
  },
  {
    type: 'string', name: 'Base URL', key: 'baseURL', required: true,
    description: 'Base URL including /v1', placeholder: 'https://api.openai.com/v1',
    default: 'https://api.openai.com/v1', scope: 'server',
  },
];

class OpenAIImagesProvider extends BaseModelProvider<OpenAIImagesConfig> {
  async getDefaultModels(): Promise<ModelList> {
    return { chat: [], embedding: [], image: defaultImageModels };
  }

  async getModelList(): Promise<ModelList> {
    const configured = getConfiguredModelProviderById(this.id)!;
    return {
      chat: [],
      embedding: [],
      image: [...defaultImageModels, ...(configured.imageModels ?? [])],
    };
  }

  async loadChatModel(_modelName: string): Promise<BaseLLM<any>> {
    throw new Error('This connection only supports image generation');
  }

  async loadEmbeddingModel(_modelName: string): Promise<BaseEmbedding<any>> {
    throw new Error('This connection only supports image generation');
  }

  async loadImageModel(modelName: string): Promise<BaseImageGenerator<any>> {
    const model = (await this.getModelList()).image?.find((m) => m.key === modelName);
    if (!model) throw new Error('Invalid image model selected');
    return new OpenAIImageGenerator({ ...this.config, model: modelName });
  }

  static parseAndValidate(raw: unknown): OpenAIImagesConfig {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid image connection config');
    const config = raw as Record<string, unknown>;
    if (!config.apiKey || !config.baseURL) throw new Error('API key and base URL must be provided');
    return { apiKey: String(config.apiKey), baseURL: String(config.baseURL) };
  }

  static getProviderConfigFields(): UIConfigField[] { return providerConfigFields; }
  static getProviderMetadata(): ProviderMetadata {
    return { key: 'openai-images', name: 'OpenAI-Compatible Images' };
  }
}

export default OpenAIImagesProvider;
