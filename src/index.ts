import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { registerProductTools } from "./tools/product.js";
import { registerCartTools } from "./tools/cart.js";
import { registerOrderTools } from "./tools/order.js";
import { registerCategoryTools } from "./tools/category.js";
import { registerReviewTools } from "./tools/review.js";
import { registerSystemTools } from "./tools/system.js";

const server = new McpServer({
    name: "shopware-store-mcp",
    version: "1.0.0",
});

// Register Tools
registerProductTools(server);
registerCartTools(server);
registerOrderTools(server);
registerCategoryTools(server);
registerReviewTools(server);
registerSystemTools(server);

if (process.env.MCP_HTTP_ENABLED !== "false") {
    const port = parseInt(process.env.MCP_HTTP_PORT || "3334");
    const app = express();
    app.use(cors());

    // Map to store active transports by session ID
    const transports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
        console.log("New SSE connection initiated");
        const transport = new SSEServerTransport("/message", res);

        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);

        transport.onclose = () => {
            console.log(`Connection closed for session ${sessionId}`);
            transports.delete(sessionId);
        };

        await server.connect(transport);
    });

    app.post("/message", async (req, res) => {
        const sessionId = req.query.sessionId as string;
        if (!sessionId) {
            res.status(400).send("Missing sessionId query parameter");
            return;
        }

        const transport = transports.get(sessionId);
        if (!transport) {
            res.status(404).send("Session not found");
            return;
        }

        console.log(`Handling message for session ${sessionId}`);
        await transport.handlePostMessage(req, res);
    });

    app.listen(port, "0.0.0.0", () => {
        console.log(`Shopware Store MCP Server running on port ${port}`);
    });
} else {
    // If HTTP is disabled, the server might be used with other transports or in a different context.
    console.log("MCP HTTP server is disabled via environment variable MCP_HTTP_ENABLED=false.");
}
