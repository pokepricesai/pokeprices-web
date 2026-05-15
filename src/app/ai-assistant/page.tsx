import type { Metadata } from 'next'
import AIAssistantClient from './AIAssistantClient'

export const metadata: Metadata = {
  title: "Ask Me Anything — Pokémon TCG AI assistant | PokePrices",
  description: 'Chat with PokePrices, a collector-built AI that knows every card, set and sold price in our database. Free, no login. Ask about grading economics, set context, market trends and more.',
  alternates: { canonical: 'https://www.pokeprices.io/ai-assistant' },
}

export default function AIAssistantPage() {
  return <AIAssistantClient />
}
