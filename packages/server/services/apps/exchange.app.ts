// services/apps/exchange.app.ts

const rates: Record<string, number> = {
   USD: 3.75,
   EUR: 4.05,
   GBP: 4.7,
   ILS: 1,
};

function extractAmount(input: string): number | null {
   // Matches: "10$", "$10", "10 USD", "10usd"
   let match = input.match(/(\d+(?:\.\d+)?)\s*\$/);
   if (match) return Number(match[1]);

   match = input.match(/\$\s*(\d+(?:\.\d+)?)/);
   if (match) return Number(match[1]);

   match = input.match(/(\d+(?:\.\d+)?)\s*(USD|EUR|GBP|ILS)\b/i);
   if (match) return Number(match[1]);

   return null;
}

export function getExchangeRate(
   currencyCode: string,
   userInput?: string
): string {
   const code = currencyCode.trim().toUpperCase();
   const rate = rates[code];

   if (!rate) {
      return `I don't have a rate for ${code}. Try USD, EUR, or GBP.`;
   }

   if (code === 'ILS') {
      return 'ILS is the base currency (1 ILS).';
   }

   const amount = userInput ? extractAmount(userInput) : null;

   if (amount !== null && Number.isFinite(amount)) {
      const converted = amount * rate;
      const pretty = Number.isInteger(converted)
         ? converted.toFixed(0)
         : converted.toFixed(2);

      return `${amount} ${code} = ${pretty} ILS (rate ${rate})`;
   }

   return `The ${code} exchange rate is ${rate} ILS`;
}
