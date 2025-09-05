interface VectorStoreEntry {
  chunk: string;
  embedding: number[];
}

type EmbeddingFunction = (text: string) => Promise<number[]>;

export class VectorStore {
  private store: VectorStoreEntry[] = [];

  private chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      const end = Math.min(i + chunkSize, text.length);
      chunks.push(text.slice(i, end));
      i += chunkSize - overlap;
      if (end === text.length) break;
    }
    return chunks;
  }
  
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async create(
    text: string, 
    embeddingFn: EmbeddingFunction,
    onProgress?: (progress: { stage: string; percentage: number }) => void
  ): Promise<void> {
    this.store = [];
    const chunks = this.chunkText(text);

    // Process chunks in parallel batches to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < chunks.length; i += batchSize) {
        const batchChunks = chunks.slice(i, i + batchSize);
        const batchEmbeddings = await Promise.all(
            batchChunks.map(chunk => embeddingFn(chunk))
        );
        batchChunks.forEach((chunk, index) => {
            this.store.push({ chunk, embedding: batchEmbeddings[index] });
        });

        if (onProgress) {
          const processedCount = Math.min(i + batchSize, chunks.length);
          const percentage = Math.round((processedCount / chunks.length) * 100);
          onProgress({
            stage: `Embedding content... (${processedCount}/${chunks.length})`,
            percentage: percentage
          });
        }
    }
  }

  async search(query: string, embeddingFn: EmbeddingFunction, topK = 3): Promise<string[]> {
    if (this.store.length === 0) {
      return [];
    }

    const queryEmbedding = await embeddingFn(query);

    const similarities = this.store.map(entry => ({
      chunk: entry.chunk,
      similarity: this.cosineSimilarity(queryEmbedding, entry.embedding),
    }));

    similarities.sort((a, b) => b.similarity - a.similarity);

    return similarities.slice(0, topK).map(item => item.chunk);
  }
}
