import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StoreApiClient, StoreCredentialsSchema } from "../client.js";

export function registerCustomerTools(server: McpServer) {
    server.registerTool(
        "store_get_customer_profile",
        {
            description: "Check if the user is currently logged in, and return their profile details if they are. Guest users will return an error or notice that they are not logged in.",
            inputSchema: StoreCredentialsSchema.shape
        },
        async (args) => {
            console.log("Executing store_get_customer_profile with args:", args);
            if (!args.swContextToken) {
                return {
                    content: [{ type: "text", text: "User is not logged in. (No context token provided)" }]
                };
            }

            const client = new StoreApiClient({
                swAccessKey: args.swAccessKey,
                swContextToken: args.swContextToken,
                shopUrl: args.shopUrl
            });

            try {
                // The /account/customer endpoint returns the logged in user profile. 
                // If it fails with a 403, the user is a guest (not logged in).
                const response = await client.get<any>("account/customer");

                if (response && response.firstName) {
                    return {
                        content: [{ type: "text", text: JSON.stringify(response) }]
                    };
                }

                return {
                    content: [{ type: "text", text: "User is not logged in." }]
                };

            } catch (error: any) {
                console.error("Failed to fetch customer profile:", error?.message || error);
                return {
                    content: [{ type: "text", text: "User is not logged in. Please ask them to log in first." }]
                };
            }
        }
    );
}
