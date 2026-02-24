import type { GetFileResponse, GetFileNodesResponse } from '@figma/rest-api-spec';

const FIGMA_API_BASE = 'https://api.figma.com/v1';

/**
 * Simple Figma REST API client.
 * Authenticates via Personal Access Token (X-Figma-Token header).
 */
export class FigmaClient {
  private headers: Record<string, string>;

  constructor(token: string) {
    if (!token) {
      throw new Error(
        'Figma token is required.\n' +
        'Set the FIGMA_TOKEN environment variable.\n' +
        'Generate one at: Figma → Settings → Account → Personal access tokens'
      );
    }
    this.headers = { 'X-Figma-Token': token };
  }

  /**
   * Fetch an entire Figma file.
   * Use `depth` to limit how deep into the tree we go.
   */
  async getFile(fileKey: string, depth?: number): Promise<GetFileResponse> {
    const params = new URLSearchParams();
    if (depth !== undefined) params.set('depth', String(depth));

    const url = `${FIGMA_API_BASE}/files/${fileKey}${params.size ? `?${params}` : ''}`;
    return this.request<GetFileResponse>(url);
  }

  /**
   * Fetch a specific node (frame/component) and its children.
   * This is the primary method — users typically share URLs to specific nodes.
   */
  async getNode(fileKey: string, nodeId: string, depth?: number): Promise<GetFileNodesResponse> {
    const params = new URLSearchParams({ ids: nodeId });
    if (depth !== undefined) params.set('depth', String(depth));

    const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?${params}`;
    return this.request<GetFileNodesResponse>(url);
  }

  /**
   * Get download URLs for rendered images of specific nodes.
   * Used for image fill handling and SVG export.
   */
  async getImages(
    fileKey: string,
    nodeIds: string[],
    format: 'png' | 'svg' = 'png',
    scale: number = 2,
  ): Promise<Record<string, string | null>> {
    const params = new URLSearchParams({
      ids: nodeIds.join(','),
      format,
      scale: String(scale),
    });

    const url = `${FIGMA_API_BASE}/images/${fileKey}?${params}`;
    const data = await this.request<{ images: Record<string, string | null> }>(url);
    return data.images;
  }

  private async request<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: this.headers });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      switch (res.status) {
        case 403:
          throw new Error(
            'Figma API: Invalid or expired token (403).\n' +
            'Regenerate your token at: Figma → Settings → Account → Personal access tokens'
          );
        case 404:
          throw new Error(
            'Figma API: File or node not found (404).\n' +
            'Check that the URL is correct and you have access to this file.'
          );
        case 429:
          throw new Error(
            'Figma API: Rate limited (429).\n' +
            'Wait a moment and try again.'
          );
        default:
          throw new Error(`Figma API error ${res.status}: ${body || res.statusText}`);
      }
    }

    return res.json() as Promise<T>;
  }
}
