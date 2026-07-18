export type GeneratedImage = {
  url: string;
  revisedPrompt?: string;
};

abstract class BaseImageGenerator<CONFIG> {
  constructor(protected config: CONFIG) {}

  abstract generate(prompt: string): Promise<GeneratedImage[]>;
}

export default BaseImageGenerator;
