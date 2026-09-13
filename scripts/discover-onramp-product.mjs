// Read-only MCP caller. This never starts a payment or exports a wallet.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const client = new Client({ name: 'set-onramp-product-discovery', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('https://set-business-consults-mpp.onrender.com/mcp')));
  const result = await client.callTool({ name: 'get_onramp_maintenance_offer', arguments: {} });
  if (result.isError) throw new Error('The product discovery tool returned an error.');
  console.log(JSON.stringify(result.structuredContent, null, 2));
} finally { await client.close(); }
