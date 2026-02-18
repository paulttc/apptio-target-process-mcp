import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { TPService, TPServiceConfig } from './api/client/tp.service.js';
import { SearchTool } from './tools/search/search.tool.js';
import { GetEntityTool } from './tools/entity/get.tool.js';
import { CreateEntityTool } from './tools/entity/create.tool.js';
import { UpdateEntityTool } from './tools/update/update.tool.js';
import { InspectObjectTool } from './tools/inspect/inspect.tool.js';

function loadConfig(): TPServiceConfig {
  const domain = process.env.TP_DOMAIN;
  const token = process.env.TP_TOKEN;

  if (!domain || !token) {
    throw new McpError(
      ErrorCode.InternalError,
      'TP_DOMAIN and TP_TOKEN must be set in the MCP server environment configuration. ' +
      'See https://www.ibm.com/docs/en/targetprocess/tp-dev-hub/saas?topic=v1-authentication for token details.'
    );
  }

  return {
    domain,
    credentials: { token }
  };
}

export class TargetProcessServer {
  private server: Server;
  private service: TPService;
  private tools: {
    search: SearchTool;
    get: GetEntityTool;
    create: CreateEntityTool;
    update: UpdateEntityTool;
    inspect: InspectObjectTool;
  };

  constructor() {
    // Initialize service
    const config = loadConfig();
    this.service = new TPService(config);

    // Initialize tools
    this.tools = {
      search: new SearchTool(this.service),
      get: new GetEntityTool(this.service),
      create: new CreateEntityTool(this.service),
      update: new UpdateEntityTool(this.service),
      inspect: new InspectObjectTool(this.service)
    };

    // Initialize server
    this.server = new Server(
      {
        name: 'target-process-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {
            search_entities: true,
            get_entity: true,
            create_entity: true,
            update_entity: true,
            inspect_object: true
          },
        },
      }
    );

    this.setupHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
    
    // Initialize entity type cache in the background
    this.initializeCache();
  }
  
  /**
   * Initialize caches in the background to improve first-request performance
   */
  private async initializeCache(): Promise<void> {
    try {
      // Initialize entity type cache
      await this.service.initializeEntityTypeCache();
    } catch (error) {
      console.error('Cache initialization error:', error);
      // Non-fatal error, server can still function
    }
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        SearchTool.getDefinition(),
        GetEntityTool.getDefinition(),
        CreateEntityTool.getDefinition(),
        UpdateEntityTool.getDefinition(),
        InspectObjectTool.getDefinition(),
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'search_entities':
            return await this.tools.search.execute(request.params.arguments);
          case 'get_entity':
            return await this.tools.get.execute(request.params.arguments);
          case 'create_entity':
            return await this.tools.create.execute(request.params.arguments);
          case 'update_entity':
            return await this.tools.update.execute(request.params.arguments);
          case 'inspect_object':
            return await this.tools.inspect.execute(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }

        return {
          content: [
            {
              type: 'text',
              text: `Target Process API error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    const timestamp = new Date().toISOString();
    console.error(`Target Process MCP server running on stdio (started at ${timestamp})`);
  }
}
