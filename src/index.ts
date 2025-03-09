import { issuer } from '@openauthjs/openauth'
import { CloudflareStorage } from '@openauthjs/openauth/storage/cloudflare'
import { PasswordProvider } from '@openauthjs/openauth/provider/password'
import { PasswordUI } from '@openauthjs/openauth/ui/password'
import { createSubjects } from '@openauthjs/openauth/subject'
import { object, string } from 'valibot'

// Definicja schematu subject
const subjects = createSubjects({
  user: object({
    id: string(),
  }),
})

// Konfiguracja nagłówków CORS – ustawiamy dozwoloną domenę
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://safemore.pl',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)

    // Obsługa preflight (OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      })
    }

    // Demo – przekierowanie dla głównej strony
    if (url.pathname === '/') {
      url.searchParams.set('redirect_uri', url.origin + '/callback')
      url.searchParams.set('client_id', 'your-client-id')
      url.searchParams.set('response_type', 'code')
      url.pathname = '/authorize'
      return new Response(null, {
        status: 302,
        headers: {
          Location: url.toString(),
          ...corsHeaders,
        },
      })
    } else if (url.pathname === '/callback') {
      return new Response(
        JSON.stringify({
          message: 'OAuth flow complete!',
          params: Object.fromEntries(url.searchParams.entries()),
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        },
      )
    }

    // Realny kod OpenAuth:
    const response = await issuer({
      storage: CloudflareStorage({
        namespace: env.AUTH_STORAGE,
      }),
      subjects,
      providers: {
        password: PasswordProvider(
          PasswordUI({
            // Funkcja wysyłająca kod – w praktyce wyślij maila z kodem weryfikacyjnym
            sendCode: async (email, code) => {
              console.error('codemail: ' + code)
              console.log('codemail: ' + code)
            },
            copy: {
              input_code: 'Code (check Worker logs)',
            },
          }),
        ),
      },
      theme: {
        title: 'myAuth',
        primary: '#0051c3',
        favicon: 'https://workers.cloudflare.com//favicon.ico',
        logo: {
          dark: 'https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/db1e5c92-d3a6-4ea9-3e72-155844211f00/public',
          light:
            'https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/fa5a3023-7da9-466b-98a7-4ce01ee6c700/public',
        },
      },
      success: async (ctx, value) => {
        return ctx.subject('user', {
          id: await getOrCreateUser(env, value.email),
        })
      },
    }).fetch(request, env, ctx)

    // Dodaj nagłówki CORS do odpowiedzi
    response.headers.set(
      'Access-Control-Allow-Origin',
      corsHeaders['Access-Control-Allow-Origin'],
    )
    response.headers.set(
      'Access-Control-Allow-Methods',
      corsHeaders['Access-Control-Allow-Methods'],
    )
    response.headers.set(
      'Access-Control-Allow-Headers',
      corsHeaders['Access-Control-Allow-Headers'],
    )
    return response
  },
} satisfies ExportedHandler<Env>

async function getOrCreateUser(env: Env, email: string): Promise<string> {
  const result = await env.AUTH_DB.prepare(
    `
		INSERT INTO user (email)
		VALUES (?)
		ON CONFLICT (email) DO UPDATE SET email = email
		RETURNING id;
		`,
  )
    .bind(email)
    .first<{ id: string }>()
  if (!result) {
    throw new Error(`Unable to process user: ${email}`)
  }
  console.log(`Found or created user ${result.id} with email ${email}`)
  return result.id
}
