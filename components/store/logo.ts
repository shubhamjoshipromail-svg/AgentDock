// Derive a logo URL for a tool/server using the favicon technique:
//   homepage host → favicon ; github repo → org avatar ; else repo host → favicon.
// Returns undefined when nothing can be derived (caller falls back to a glyph).
function host(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

export function deriveLogoSrc(server: {
  homepageUrl?: string | null;
  repositoryUrl?: string | null;
}): string | undefined {
  const repoHost = server.repositoryUrl ? host(server.repositoryUrl) : undefined;
  if (repoHost === "github.com" && server.repositoryUrl) {
    const match = server.repositoryUrl.match(/github\.com\/([^/]+)/);
    if (match) return `https://github.com/${match[1]}.png?size=64`;
  }
  const domain = (server.homepageUrl && host(server.homepageUrl)) || repoHost;
  if (domain) return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  return undefined;
}
