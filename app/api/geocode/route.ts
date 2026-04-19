import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { addresses } = await request.json();

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json({ error: 'addresses array required' }, { status: 400 });
    }

    const key = process.env.GOOGLE_MAPS_SERVER_KEY;
    if (!key) {
      return NextResponse.json({ error: 'GOOGLE_MAPS_SERVER_KEY not configured' }, { status: 503 });
    }

    const results = await Promise.all(
      addresses.map(async (addr: string) => {
        try {
          const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${key}`;
          const res = await fetch(url);
          const data = await res.json();
          if (data.status !== 'OK' || !data.results?.[0]?.geometry?.location) {
            return { address: addr, lat: null, lng: null, status: data.status };
          }
          const { lat, lng } = data.results[0].geometry.location;
          return { address: addr, lat, lng, status: 'OK' };
        } catch (err: any) {
          return { address: addr, lat: null, lng: null, status: 'ERROR', error: err.message };
        }
      })
    );

    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'geocode_failed' }, { status: 500 });
  }
}
