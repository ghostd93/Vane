import { ResearcherOutput, SearchAgentInput } from './types';
import SessionManager from '@/lib/session';
import { classify } from './classifier';
import Researcher from './researcher';
import { getWriterPrompt } from '@/lib/prompts/search/writer';
import { WidgetExecutor } from './widgets';
import db from '@/lib/db';
import { messages } from '@/lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';
import { ImageBlock, Message, TextBlock } from '@/lib/types';
import { Tool, ToolCall } from '@/lib/models/types';
import z from 'zod';
import { getTokenCount } from '@/lib/utils/splitText';

class SearchAgent {
  async searchAsync(session: SessionManager, input: SearchAgentInput) {
    const exists = await db.query.messages.findFirst({
      where: and(
        eq(messages.chatId, input.chatId),
        eq(messages.messageId, input.messageId),
      ),
    });

    if (!exists) {
      await db.insert(messages).values({
        chatId: input.chatId,
        messageId: input.messageId,
        backendId: session.id,
        query: input.followUp,
        createdAt: new Date().toISOString(),
        status: 'answering',
        responseBlocks: [],
      });
    } else {
      await db
        .delete(messages)
        .where(
          and(eq(messages.chatId, input.chatId), gt(messages.id, exists.id)),
        )
        .execute();
      await db
        .update(messages)
        .set({
          status: 'answering',
          backendId: session.id,
          responseBlocks: [],
        })
        .where(
          and(
            eq(messages.chatId, input.chatId),
            eq(messages.messageId, input.messageId),
          ),
        )
        .execute();
    }

    const classification = await classify({
      chatHistory: input.chatHistory,
      enabledSources: input.config.sources,
      query: input.followUp,
      llm: input.config.llm,
    });

    const widgetPromise = WidgetExecutor.executeAll({
      classification,
      chatHistory: input.chatHistory,
      followUp: input.followUp,
      llm: input.config.llm,
    }).then((widgetOutputs) => {
      widgetOutputs.forEach((o) => {
        session.emitBlock({
          id: crypto.randomUUID(),
          type: 'widget',
          data: {
            widgetType: o.type,
            params: o.data,
          },
        });
      });
      return widgetOutputs;
    });

    let searchPromise: Promise<ResearcherOutput> | null = null;

    if (!classification.classification.skipSearch) {
      const researcher = new Researcher();
      searchPromise = researcher.research(session, {
        chatHistory: input.chatHistory,
        followUp: input.followUp,
        classification: classification,
        config: input.config,
      });
    }

    const [widgetOutputs, searchResults] = await Promise.all([
      widgetPromise,
      searchPromise,
    ]);

    session.emit('data', {
      type: 'researchComplete',
    });

    let finalContext =
      '<Query to be answered without searching; Search not made>';

    if (searchResults) {
      finalContext = searchResults?.searchFindings
        .map(
          (f, index) =>
            `<result index=${index + 1} title=${f.metadata.title}>${f.content}</result>`,
        )
        .join('\n');
    }

    const widgetContext = widgetOutputs
      .map((o) => {
        return `<result>${o.llmContext}</result>`;
      })
      .join('\n-------------\n');

    const finalContextWithWidgets = `<search_results note="These are the search results and assistant can cite these">\n${finalContext}\n</search_results>\n<widgets_result noteForAssistant="Its output is already showed to the user, assistant can use this information to answer the query but do not CITE this as a souce">\n${widgetContext}\n</widgets_result>`;

    const writerPrompt = getWriterPrompt(
      finalContextWithWidgets,
      input.config.systemInstructions,
      input.config.mode,
    );

    const agentMessages: Message[] = [
      { role: 'system' as const, content: writerPrompt },
      ...input.chatHistory,
      { role: 'user' as const, content: input.followUp },
    ];
    const imageTool: Tool[] = input.config.imageGenerator
      ? [{
          name: 'generate_image',
          description: 'Generate an image when the user explicitly asks for an image, illustration, artwork, logo, or visual. Use the user request to write a detailed image prompt.',
          schema: z.object({ prompt: z.string().describe('A detailed image-generation prompt.') }),
        }]
      : [];
    let responseBlockId = '';

    for (let iteration = 0; iteration < 2; iteration++) {
      const answerStream = input.config.llm.streamText({
        messages: agentMessages,
        tools: iteration === 0 ? imageTool : undefined,
      });
      const toolCalls = new Map<string, ToolCall>();

      for await (const chunk of answerStream) {
        if (chunk.toolCallChunk.length > 0) {
          chunk.toolCallChunk.forEach((call) => toolCalls.set(call.id, call));
        }
        if (!chunk.contentChunk) continue;
        if (!responseBlockId) {
          const block: TextBlock = { id: crypto.randomUUID(), type: 'text', data: chunk.contentChunk };
          session.emitBlock(block);
          responseBlockId = block.id;
        } else {
          const block = session.getBlock(responseBlockId) as TextBlock | null;
          if (!block) continue;
          block.data += chunk.contentChunk;
          session.updateBlock(block.id, [{ op: 'replace', path: '/data', value: block.data }]);
        }
      }

      const calls = [...toolCalls.values()].filter((call) => call.name === 'generate_image');
      if (!calls.length || !input.config.imageGenerator || iteration > 0) break;

      agentMessages.push({ role: 'assistant', content: '', tool_calls: calls });
      for (const call of calls) {
        const prompt = String(call.arguments.prompt || '').trim();
        try {
          if (!prompt) throw new Error('An image prompt is required');
          const images = await input.config.imageGenerator.generate(prompt);
          if (images.length === 0) throw new Error('The image API returned no images');

          const imageBlock: ImageBlock = {
            id: crypto.randomUUID(), type: 'image', data: { prompt, images },
          };
          session.emitBlock(imageBlock);
          agentMessages.push({
            role: 'tool', id: call.id, name: call.name,
            content: JSON.stringify({ generated: images.length, prompt }),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Image generation failed';
          console.error('Image generation failed:', err);
          agentMessages.push({
            role: 'tool', id: call.id, name: call.name,
            content: JSON.stringify({ error: message }),
          });
        }
      }
    }

    session.emit('end', {});

    await db
      .update(messages)
      .set({
        status: 'completed',
        responseBlocks: session.getAllBlocks(),
      })
      .where(
        and(
          eq(messages.chatId, input.chatId),
          eq(messages.messageId, input.messageId),
        ),
      )
      .execute();
  }
}

export default SearchAgent;
