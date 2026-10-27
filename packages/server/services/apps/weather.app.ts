// services/apps/weather.app.ts

function codeToText(code?: number): string {
   if (code == null) return 'unknown conditions';
   if (code === 0) return 'clear';
   if ([1, 2, 3].includes(code)) return 'partly cloudy';
   if ([45, 48].includes(code)) return 'foggy';
   if ([51, 53, 55].includes(code)) return 'drizzle';
   if ([61, 63, 65].includes(code)) return 'rain';
   if ([71, 73, 75, 77].includes(code)) return 'snow';
   if ([80, 81, 82].includes(code)) return 'rain showers';
   if ([95, 96, 99].includes(code)) return 'thunderstorms';
   return 'mixed conditions';
}

export async function getWeather(city: string): Promise<string> {
   const geoUrl =
      'https://geocoding-api.open-meteo.com/v1/search?count=1&name=' +
      encodeURIComponent(city);

   const geoRes = await fetch(geoUrl);
   if (!geoRes.ok) return `I couldn't look up "${city}" right now.`;

   const geoJson: any = await geoRes.json();
   const first = geoJson?.results?.[0];
   if (!first) return `I couldn't find a city named "${city}".`;

   const { latitude, longitude, name, country } = first;

   const weatherUrl =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${latitude}&longitude=${longitude}` +
      '&current=temperature_2m,weather_code,wind_speed_10m';

   const wRes = await fetch(weatherUrl);
   if (!wRes.ok) return 'Weather service error. Please try again.';

   const wJson: any = await wRes.json();
   const current = wJson?.current;

   const temp = current?.temperature_2m as number | undefined;
   const wind = current?.wind_speed_10m as number | undefined;
   const code = current?.weather_code as number | undefined;

   if (typeof temp !== 'number') return 'Weather data was unavailable.';

   const desc = codeToText(code);
   const windPart = typeof wind === 'number' ? `, wind ${wind} km/h` : '';

   return `${name}${country ? `, ${country}` : ''}: ${temp}°C, ${desc}${windPart}`;
}
