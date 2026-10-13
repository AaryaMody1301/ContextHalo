# Free API providers and published benchmark review

Reviewed: October 12, 2026. Target: ContextHalo on Windows x64, especially interactive text and screenshot analysis.

## Findings

Mistral is the strongest next candidate for evaluating responsive text and screenshots because published measurements cover its own API. Z.ai offers explicitly free text and vision models, but the independent speed results found for GLM-4.7-Flash measure other hosts. They do not establish the speed of Z.ai's free endpoint. SambaNova is a promising text alternative with a restrictive free daily allowance. These are recommendations from the evidence below, not results from a ContextHalo live test.

The user selected **published benchmarks only**. No inference requests, account creation, purchases, API-key creation, or provider integrations were performed. Existing Gemini fixes remain separate from this report.

## Published performance evidence

Values below are approximate snapshots of the detailed provider tables from Artificial Analysis, accessed October 12. The pages describe a default 10,000-input-token workload and median performance over the preceding 72 hours. Page summaries and tables can show slightly different values as their snapshots update. The reported 500-answer-token duration is calculated using measured generation speed and, when applicable, reasoning time; it is not a stopwatch measurement of a ContextHalo response.

| Model and measured host | Mode | Output tokens/second | First chunk, seconds | Reported 500-answer-token duration, seconds | Source |
| --- | --- | ---: | ---: | ---: | --- |
| Mistral Small 4 on Mistral | Non-reasoning | 151 | 0.72 | 4.03 | [Provider measurements](https://artificialanalysis.ai/models/mistral-small-4-non-reasoning/providers) |
| GLM-4.7-Flash on Novita | Non-reasoning | 64 | 2.85 | 10.72 | [Provider measurements](https://artificialanalysis.ai/models/glm-4-7-flash-non-reasoning/providers) |
| GLM-4.7-Flash on Amazon Bedrock | Non-reasoning | 183 | 1.12 | 3.85 | [Provider measurements](https://artificialanalysis.ai/models/glm-4-7-flash-non-reasoning/providers) |
| GPT-OSS-120B on Groq | High reasoning | 471 | 0.71 | 6.01 | [Same-model provider comparison](https://artificialanalysis.ai/models/gpt-oss-120b/providers) |
| GPT-OSS-120B on SambaNova | High reasoning | 706 | 1.15 | 4.69 | [Same-model provider comparison](https://artificialanalysis.ai/models/gpt-oss-120b/providers) |
| GLM-4.7-Flash on Z.ai's free API | Not independently established | Not established | Not established | Not established | Z.ai is absent from the measured hosts in the GLM comparison above |

Interpretation:

- Mistral's measured first response is promising for interactive use. Its free-plan scheduling and latency were not separately established by these measurements.
- SambaNova generates this GPT-OSS model about 1.5 times as fast as Groq in the cited comparison, but starts its first chunk later. The two reasoning rows are comparable to one another; they do not establish a same-task quality ranking against the non-reasoning rows.
- A first chunk can contain reasoning rather than a visible answer. Tokens/second alone is insufficient to predict perceived response time.
- A GLM model's performance changes substantially with its host. Amazon and Novita measurements cannot be substituted for Z.ai free-endpoint measurements.
- These results do not establish Indian network latency, free-plan reliability, HTTP error rates, screenshot upload/processing time, audio latency, or performance under ContextHalo's actual prompts.

The default benchmark workload also exceeds Groq's currently documented 8,000-token/minute free allowance for GPT-OSS-120B. The published workload is therefore not evidence that the same requests fit Groq's free quota. [Groq limits](https://console.groq.com/docs/rate-limits)

### Quality and screenshot evidence

Artificial Analysis reports estimated Intelligence Index scores of **9 for Mistral Small 4 non-reasoning** and **11 for GLM-4.7-Flash non-reasoning**. These broad model scores do not measure ContextHalo screenshot accuracy or free-endpoint reliability. [Mistral model results](https://artificialanalysis.ai/models/mistral-small-4-non-reasoning), [GLM model results](https://artificialanalysis.ai/models/glm-4-7-flash-non-reasoning)

Mistral Small 4 accepts images as well as text. GLM-4.7-Flash is the text candidate; Z.ai's separate GLM-4.6V-Flash is the vision candidate. Its model card describes screenshot and document input. No directly comparable published latency test of the two free screenshot endpoints was established in this review. [Mistral model release](https://mistral.ai/news/mistral-small-4/), [GLM-4.6V-Flash model card](https://huggingface.co/zai-org/GLM-4.6V-Flash)

For a later integration, benchmark the documented low-reasoning settings rather than accidentally comparing default extended thinking: Mistral Small 4 supports `reasoning_effort: 'none'`; compatible GLM-4.7 models support `thinking: { type: 'disabled' }`. Disabling reasoning can change answer quality. The GLM-5.3 series has different constraints and is not the free GLM-4.7-Flash model. [Mistral reasoning](https://docs.mistral.ai/studio/conversations/reasoning), [Z.ai thinking controls](https://docs.z.ai/guides/capabilities/thinking-mode)

## Free API options

These are separate account allowances, not one combined pool. Availability, quotas and model eligibility can change. A gateway's own free quota does not imply that its upstream providers offer the same direct free quota.

| Provider | Verified free access | ContextHalo fit and practical limit | Official evidence |
| --- | --- | --- | --- |
| Z.ai | GLM-4.7-Flash and GLM-4.5-Flash text, plus GLM-4.6V-Flash vision, have zero listed token prices | Text and screenshots; account/model limits need checking. GLM-5.3-Flash and FlashX are different, paid models. Web search is separately priced. | [Pricing](https://docs.z.ai/guides/overview/pricing) |
| Mistral | Free API mode with no card required | Text and vision models; free mode is for evaluation/prototyping, with organization/model request, token/minute and token/month caps. No universal dollar allowance was established. | [API activation](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key), [Limits](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them) |
| SambaNova | Listed free production models: 20 requests/minute, 20 requests/day and 200,000 tokens/day per model | GPT-OSS-120B, Llama 3.3 70B and DeepSeek V3.1 text alternatives. Twenty daily requests is restrictive for a long session. | [Limits](https://docs.sambanova.ai/docs/en/models/rate-limits) |
| Cloudflare Workers AI | 10,000 Neurons each day | Eligible text, vision and Whisper models. Neurons measure compute, not a fixed token/request count. Some frontier models require billing; the free plan rejects excess usage. | [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Models](https://developers.cloudflare.com/workers-ai/models/) |
| OpenRouter | Free-model requests: 20/minute and 50/day for an account with no credit purchases | Model-dependent text and vision. The 1,000/day allowance requires at least $10 of purchases. Choose an explicit eligible model rather than relying on a changing automatic model router. | [Limits](https://openrouter.ai/docs/api_reference/limits), [Official quota constants](https://github.com/OpenRouterTeam/docs/blob/main/snippets/exports/constants.mdx#L104) |
| Kilo Gateway | Models tagged `:free` cost zero; free traffic is capped at 200 requests/hour/IP | OpenAI-compatible streaming gateway. Available free models change; verify vision support for the chosen model. Some free models require permission for data collection. Auto Free changes the underlying model, so it is not an equivalent fixed-model benchmark. | [Gateway](https://kilo.ai/docs/gateway), [Billing and limits](https://kilo.ai/docs/gateway/usage-and-billing), [Auto Free](https://kilo.ai/docs/getting-started/rate-limits-and-costs) |
| Vercel AI Gateway | $5/month for free-tier-eligible models | Model-dependent text and vision. Lower per-model limits apply. Purchasing credits moves the team to paid status and ends the monthly free allowance. | [Current pricing](https://vercel.com/docs/ai-gateway/pricing) |
| Ollama Cloud | Monthly starter allowance for a subset of models | One concurrent request; the public page does not specify the free credit amount. Cloud API access is separate from running models on your own hardware. | [Pricing](https://ollama.com/pricing), [Cloud API](https://docs.ollama.com/cloud) |
| Hugging Face Inference Providers | $0.10/month for free users, subject to change | A small experiment budget for eligible hosted models. Credits apply to Hugging Face-routed calls, not calls billed through a custom provider key. | [Pricing](https://huggingface.co/docs/inference-providers/en/pricing) |
| Cohere | Free evaluation keys; 1,000 calls/month, with Chat at 20 requests/minute | Text and Command A Vision evaluation; audio transcription has a separate 5 requests/minute limit. Treat production access as a separate paid decision. | [Evaluation and production limits](https://docs.cohere.com/v2/docs/rate-limits), [Going live](https://docs.cohere.com/docs/going-live) |
| NVIDIA hosted NIM previews | Developer Program members receive free endpoint access for prototyping | Model-dependent experiments. The reviewed source does not establish a universal permanent production allowance or fixed request quota. | [Developer access](https://docs.api.nvidia.com/nim/docs/run-anywhere) |
| SiliconFlow China | Selected models are free after identity verification | A conditional regional option. Model limits are fixed; current free model IDs and the user's signup eligibility need verification. This does not establish the same offer on SiliconFlow's international service. | [Free-model policy](https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation) |

### Additional offers requiring qualification

- **ModelScope:** its August 2026 points announcement includes API-Inference and a daily 200-point login grant. Current account/model conversion and access eligibility were not independently established. The old 2,000-free-requests/day announcement should not be treated as a confirmed current quota. [Points announcement](https://www.modelscope.cn/posts/435591), [Earlier launch announcement](https://community.modelscope.cn/675262372db35d1195183bdb.html)
- **Scaleway:** the FAQ describes a free pool of 1,000,000 tokens and 60 transcription minutes, followed by billing. The reviewed pages did not establish whether this allowance renews; its landing page describes a new-customer offer. Do not present it as a verified monthly allowance. [FAQ](https://www.scaleway.com/en/docs/generative-apis/faq/), [Offer](https://www.scaleway.com/en/generative-apis/)
- **Pollinations:** free access is now tied to Quest Pollen/rewards or zero-priced models. Terms do not promise fixed future grant amounts or timing. The API requires authentication; older anonymous-unlimited examples are unsuitable. [Current API docs](https://gen.pollinations.ai/docs), [Credit terms](https://enter.pollinations.ai/terms)

## Offers excluded from an ongoing-free recommendation

| Service | Reason | Official evidence |
| --- | --- | --- |
| Cerebras | $5 trial requiring a verified payment method, expiring after 30 days; no renewing free tier | [Trial FAQ](https://inference-docs.cerebras.ai/support/rate-limits) |
| GitHub Models | The inference API and related service were retired July 30, 2026 | [Retirement notice](https://docs.github.com/en/github-models) |
| Featherless | The current pricing page lists paid Chat, Developer and Business plans. Its Chat plan excludes app/API traffic and benchmarking | [Pricing](https://featherless.ai/pricing) |
| Venice | Its free account has zero monthly credits; API use spends credits | [Current pricing](https://venice.ai/pricing) |
| Tencent's legacy Hunyuan platform | The cited legacy platform/API shut down September 30, 2026; migration credits are time-limited. Earlier Hunyuan Lite advice is insufficient for a new integration | [Migration and retirement announcement](https://intl.cloud.tencent.com/zh/announce/detail/101147) |

## Recommendation for ContextHalo

1. Keep Groq as the working default while evaluating alternatives. Its free GPT-OSS-120B quota is substantially larger in daily requests than SambaNova's current offer, although token limits also apply. [Groq limits](https://console.groq.com/docs/rate-limits)
2. Evaluate **Mistral Small 4 first** for responsive text and screenshots. Use a specific model version and an explicit reasoning setting; do not claim that the published measurements guarantee free-plan performance.
3. Evaluate **Z.ai second**, using the correct separate free text and vision models. Actual free-endpoint latency is still an evidence gap.
4. Consider **SambaNova for occasional text requests** and **Cloudflare or Vercel for another limited provider option**. Kilo offers an additional experimental gateway, subject to model stability and its data-collection requirements.
5. Preserve explicit provider/model selection and separate audio configuration. A text/vision API is not a drop-in replacement for Gemini Live. Reuse existing bounded HTTP streaming and cancellation patterns if integration is requested; do not add every provider merely because it has a free offer.

No production availability ranking or screenshot-accuracy winner is established. A future live acceptance run should use the same sanitized text prompts and screenshot fixtures, compare first visible answer and total duration, record failures including 429/503, assess screenshot facts and text readability, and verify cancellation. That run was not performed because the user requested published evidence only.
