import z from "zod";

export const StoreCredentialsSchema = z.object({
    swAccessKey: z.string().optional().describe("The Shopware Sales Channel Access Key (public) - INJECTED AUTOMATICALLY"),
    swContextToken: z.string().optional().describe("The Visitor's Context Token (Session/Cart ID) - INJECTED AUTOMATICALLY"),
    swLanguageId: z.string().optional().describe("The Language ID for the context (e.g. for English)"),
    shopUrl: z.string().optional().describe("The Base URL of the Shopware Shop - INJECTED AUTOMATICALLY"),
});

export type StoreCredentials = z.infer<typeof StoreCredentialsSchema>;

export class StoreApiClient {
    constructor(private credentials: StoreCredentials) { }

    private get headers(): HeadersInit {
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "sw-access-key": this.credentials.swAccessKey || "",
            "sw-context-token": this.credentials.swContextToken || "",
            "sw-language-id": this.credentials.swLanguageId || "",
        };
    }

    private get baseUrl(): string {
        return (this.credentials.shopUrl || "").replace(/\/$/, "");
    }

    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.baseUrl}/store-api/${path.replace(/^\//, "")}`;

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...this.headers,
                    ...options.headers,
                },
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Store API Request failed: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            // Handle 204 No Content
            if (response.status === 204) {
                return {} as T;
            }

            return await response.json() as T;
        } catch (error) {
            console.error(`Store API Error [${path}]:`, error);
            throw error;
        }
    }

    async post<T>(path: string, body: any): Promise<T> {
        return this.request<T>(path, {
            method: "POST",
            body: JSON.stringify(body),
        });
    }

    async get<T>(path: string): Promise<T> {
        return this.request<T>(path, {
            method: "GET",
        });
    }

    async resolveProductId(idOrSku: string): Promise<string | null> {
        // Simple UUID regex
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const simpleUuidRegex = /^[0-9a-f]{32}$/i;

        if (uuidRegex.test(idOrSku) || simpleUuidRegex.test(idOrSku)) {
            return idOrSku;
        }

        console.log(`Input '${idOrSku}' is not a UUID, searching for product number...`);
        try {
            // Search by productNumber
            const response = await this.post<any>("search", {
                filter: [
                    {
                        type: "equals",
                        field: "productNumber",
                        value: idOrSku
                    }
                ],
                includes: {
                    product: ["id"]
                },
                limit: 1
            });

            if (response.elements && response.elements.length > 0) {
                const foundId = response.elements[0].id;
                console.log(`Resolved SKU '${idOrSku}' to ID '${foundId}'`);
                return foundId;
            }
        } catch (error) {
            console.error("Error resolving product ID:", error);
        }

        return null;
    }
}
