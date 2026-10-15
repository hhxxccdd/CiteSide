import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

@Injectable()
export class EmbeddingService {
  constructor(private readonly config: ConfigService) {}

  async embed(text: string): Promise<number[]> {
    const input = text.trim();

    if (!input) {
      throw new Error("不能为没有内容的文字生成向量");
    }

    const apiKey = this.config.getOrThrow<string>("DASHSCOPE_API_KEY");
    const baseUrl = this.config.getOrThrow<string>("DASHSCOPE_BASE_URL");
    const model = this.config.getOrThrow<string>("EMBEDDING_MODEL");

    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/embeddings`,{

        method:'POST',
        headers:{
            Authorization:`Bearer ${apiKey}`,
            'Content-type':'application/json'
        },
        body:JSON.stringify({
            model,
            input,
            dimensions:1024,
            encoding_format:'float'
        }),
        signal:AbortSignal.timeout(30_000)
    })

    if(!response.ok){
        throw new Error(`生成向量失败：HTTP${response.status}`)
    }

    const result = (await response.json()) as EmbeddingResponse
    const vector = result.data?.[0]?.embedding

    if (
      !Array.isArray(vector) ||
      vector.length !== 1024 ||
      !vector.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new Error('向量模型没有返回有效的 1024 维数据');
    }

    return vector;
  }


}
