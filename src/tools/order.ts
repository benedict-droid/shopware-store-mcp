import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StoreApiClient, StoreCredentialsSchema } from "../client.js";

export function registerOrderTools(server: McpServer) {
    server.registerTool(
        "store_order_list",
        {
            description: "List orders for the currently logged-in customer.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                limit: z.number().default(5).describe("Max number of orders to return"),
            })).shape
        },
        async (args) => {
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                shopUrl: args.shopUrl
            });

            try {
                // POST /store-api/order with criteria
                const response = await client.post<any>("order", {
                    limit: args.limit,
                    sort: [{ field: "orderDateTime", order: "DESC" }],
                    associations: {
                        lineItems: {},
                        stateMachineState: {}
                    }
                });

                if (!response.orders || response.orders.length === 0) {
                    return {
                        content: [{ type: "text", text: "No orders found for this customer." }]
                    };
                }

                const orders = response.orders.map((o: any) => {
                    const date = new Date(o.orderDateTime).toLocaleDateString();
                    const state = o.stateMachineState?.name || "Unknown";
                    return `- Order #${o.orderNumber} (${date}) - Status: ${state} - Total: ${o.price.totalPrice}`;
                }).join("\n");

                return {
                    content: [{ type: "text", text: `Your Orders:\n${orders}` }]
                };

            } catch (error: any) {
                // If 403, usually means not logged in
                if (error.message && error.message.includes("403")) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Access Denied: You must be logged in to view orders." }]
                    };
                }
                throw error;
            }
        }
    );

    server.registerTool(
        "store_order_create",
        {
            description: "Place an order from the current cart.",
            inputSchema: StoreCredentialsSchema.merge(z.object({
                comment: z.string().optional().describe("Optional comment for the order"),
            })).shape
        },
        async (args) => {
            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                shopUrl: args.shopUrl
            });

            try {
                const response = await client.post<any>("checkout/order", {
                    customerComment: args.comment
                });

                return {
                    content: [{ type: "text", text: `Success! Order placed. Order Number: ${response.orderNumber} (ID: ${response.id})` }]
                };
            } catch (error: any) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Failed to place order. Ensure you have items in cart and are logged in (or provided guest details). Error: ${error}` }]
                };
            }
        }
    );
}
