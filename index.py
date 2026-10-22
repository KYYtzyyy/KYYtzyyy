
# api/index.py
import os
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="AniBay API", version="1.0.0")

# Isi dengan URL frontend saat sudah di-deploy.
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["Content-Type"],
)

UPSTREAM = os.getenv(
    "ANIBAY_UPSTREAM",
    "https://irens.anibay.app/api"
).rstrip("/")

# Hanya endpoint GET yang dibutuhkan oleh fitur publik AniBay.
PUBLIC_ENDPOINTS = {
    "home": "/home",
    "browse": "/browse",
    "filters": "/browse/filters",
    "search": "/search",
    "trending": "/sections/trending",
    "schedule": "/schedule",
    "anime": "/anime/{id}",
    "providers": "/anime/{id}/providers",
}


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "AniBay API"}


async def upstream_get(path: str, params: Optional[dict] = None):
    """GET biasa tanpa header bypass atau kredensial tambahan."""
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(12.0, connect=5.0),
            follow_redirects=False,
        ) as client:
            response = await client.get(
                f"{UPSTREAM}{path}",
                params=params or {},
                headers={"Accept": "application/json"},
            )

        content_type = response.headers.get("content-type", "")
        if response.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail={
                    "message": "API upstream menolak atau gagal memproses request.",
                    "upstream_status": response.status_code,
                },
            )

        if "json" not in content_type.lower():
            raise HTTPException(
                status_code=502,
                detail="API upstream tidak mengembalikan JSON.",
            )

        try:
            return response.json()
        except ValueError:
            raise HTTPException(
                status_code=502,
                detail="Respons API bukan JSON yang valid.",
            )

    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="API upstream terlalu lama merespons.",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="Tidak dapat terhubung ke API upstream.",
        )


@app.get("/api/home")
async def get_home():
    return await upstream_get(PUBLIC_ENDPOINTS["home"])


@app.get("/api/browse")
async def browse(page: int = Query(default=1, ge=1, le=500)):
    return await upstream_get(
        PUBLIC_ENDPOINTS["browse"],
        {"page": page},
    )


@app.get("/api/filters")
async def filters():
    return await upstream_get(PUBLIC_ENDPOINTS["filters"])


@app.get("/api/search")
async def search(query: str = Query(min_length=1, max_length=100)):
    return await upstream_get(
        PUBLIC_ENDPOINTS["search"],
        {"query": query},
    )


@app.get("/api/trending")
async def trending(
    section: str = Query(default="trending", pattern="^(trending|popular|latest)$")
):
    return await upstream_get(
        PUBLIC_ENDPOINTS["trending"],
        {"slug": section},
    )


@app.get("/api/schedule")
async def schedule():
    return await upstream_get(PUBLIC_ENDPOINTS["schedule"])


@app.get("/api/anime/{anime_id}")
async def anime_detail(anime_id: str):
    # ID path-only: tidak menerima URL atau slash.
    if not anime_id or len(anime_id) > 100:
        raise HTTPException(status_code=400, detail="ID anime tidak valid.")
    if "/" in anime_id or ".." in anime_id:
        raise HTTPException(status_code=400, detail="ID anime tidak valid.")

    return await upstream_get(f"/anime/{anime_id}")


@app.get("/api/anime/{anime_id}/providers")
async def anime_providers(anime_id: str):
    if not anime_id or len(anime_id) > 100:
        raise HTTPException(status_code=400, detail="ID anime tidak valid.")
    if "/" in anime_id or ".." in anime_id:
        raise HTTPException(status_code=400, detail="ID anime tidak valid.")

    return await upstream_get(f"/anime/{anime_id}/providers")


@app.get("/api/explorer")
async def api_explorer(
    endpoint: str = Query(
        description="Nama endpoint yang diizinkan",
        pattern="^(home|browse|filters|search|trending|schedule)$",
    ),
    query: Optional[str] = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1, le=500),
    section: str = Query(
        default="trending",
        pattern="^(trending|popular|latest)$",
    ),
):
    # Endpoint explorer dibatasi agar tidak menjadi proxy URL bebas.
    params = {}
    if endpoint == "browse":
        params["page"] = page
    elif endpoint == "search":
        if not query:
            raise HTTPException(
                status_code=400,
                detail="Parameter query diperlukan untuk search.",
            )
        params["query"] = query
    elif endpoint == "trending":
        params["slug"] = section

    return {
        "endpoint": endpoint,
        "method": "GET",
        "data": await upstream_get(PUBLIC_ENDPOINTS[endpoint], params),
    }


@app.exception_handler(HTTPException)
async def api_error_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )
