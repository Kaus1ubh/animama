#!/usr/bin/env python3
"""Populate archive embeddings database with sample passages.

This script:
1. Creates an archive if it doesn't exist
2. Generates embeddings via OpenAI text-embedding-3-small
3. Stores passages with embeddings in the archive_passages table

Usage:
    python scripts/populate_archive_embeddings.py <archive_id>
    python scripts/populate_archive_embeddings.py my-archive

Environment variables:
    OPENAI_API_KEY: Your OpenAI API key
    ANIMAMA_DATABASE_URL: Database connection string (default: postgresql+asyncpg://animama:animama@localhost:5432/animama)
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

import httpx

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

# OpenAI API configuration
import dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

dotenv.load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
EMBEDDING_MODEL = "text-embedding-3-small"

# Database configuration
DATABASE_URL = os.getenv("ANIMAMA_DATABASE_URL", "postgresql+asyncpg://animama:animama@localhost:5432/animama")

# Sample passages to embed (you can replace these with your own)
SAMPLE_PASSAGES = [
    {
        "text": (
            "The user prefers dark mode interfaces and minimalist design. They mentioned this during our first "
            "conversation about UI preferences."
        ),
        "tags": ["preferences", "ui", "design"],
    },
    {
        "text": (
            "User's favorite programming language is Python, followed by TypeScript. They enjoy building backend "
            "systems and APIs."
        ),
        "tags": ["preferences", "programming", "technical"],
    },
    {
        "text": (
            "The user lives in San Francisco and works as a software engineer at a startup. They commute by bike "
            "most days."
        ),
        "tags": ["personal", "location", "work"],
    },
    {
        "text": "Important meeting scheduled for next Tuesday at 2pm with the product team to discuss the Q4 roadmap.",
        "tags": ["calendar", "meetings", "work"],
    },
    {
        "text": (
            "User mentioned they're learning Rust in their spare time and find the borrow checker challenging but "
            "rewarding."
        ),
        "tags": ["learning", "programming", "rust"],
    },
    {
        "text": "The user has a dog named Max, a golden retriever. They usually walk him in the morning before work.",
        "tags": ["personal", "pets"],
    },
    {
        "text": "Dietary preferences: vegetarian, no nuts due to allergy. Enjoys Thai and Indian cuisine.",
        "tags": ["preferences", "food", "health"],
    },
    {
        "text": "The user's birthday is March 15th. They prefer experiences over gifts and enjoy outdoor activities.",
        "tags": ["personal", "birthday", "preferences"],
    },
    {
        "text": (
            "Project Alpha deadline is December 1st. Key deliverables include the API refactor and new "
            "authentication system."
        ),
        "tags": ["work", "projects", "deadlines"],
    },
    {
        "text": (
            "The user mentioned feeling stressed about work-life balance lately. They're trying to set better "
            "boundaries with work hours."
        ),
        "tags": ["personal", "wellbeing", "work"],
    },
    {
        "text": (
            "Favorite books include 'Designing Data-Intensive Applications' and 'The Pragmatic Programmer'. "
            "Currently reading 'Staff Engineer'."
        ),
        "tags": ["preferences", "books", "technical"],
    },
    {
        "text": (
            "The user uses VS Code as their primary editor with Vim keybindings. They have a custom theme called "
            "'Nord'."
        ),
        "tags": ["preferences", "tools", "development"],
    },
]


async def create_embeddings(texts: list[str]) -> list[list[float]]:
    """Create embeddings using OpenAI API.

    Args:
        texts: List of text strings to embed

    Returns:
        List of embedding vectors
    """
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY environment variable not set")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            OPENAI_EMBEDDINGS_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "input": texts,
                "model": EMBEDDING_MODEL,
            },
            timeout=60.0,
        )
        response.raise_for_status()

        data = response.json()

        # Sort by index to ensure correct order
        embeddings_data = sorted(data["data"], key=lambda x: x["index"])
        embeddings = [item["embedding"] for item in embeddings_data]

        print(f"Created {len(embeddings)} embeddings (dimension: {len(embeddings[0])})")
        return embeddings


async def ensure_archive_exists(session: AsyncSession, archive_id: str, name: str) -> str:
    """Ensure an archive exists, creating it if necessary.

    Returns the archive ID.
    """
    # Check if archive exists
    result = await session.execute(text("SELECT id FROM archives WHERE id = :id"), {"id": archive_id})
    existing = result.fetchone()

    if existing:
        print(f"Archive '{archive_id}' already exists")
        return archive_id

    # Create new archive
    await session.execute(
        text("""
            INSERT INTO archives (id, name, description, metadata_, created_at, updated_at)
            VALUES (:id, :name, :description, :metadata, NOW(), NOW())
        """),
        {
            "id": archive_id,
            "name": name,
            "description": "Sample archive for testing tiered memory retrieval",
            "metadata": "{}",
        },
    )
    await session.commit()
    print(f"Created archive '{archive_id}'")
    return archive_id


async def insert_passages(
    session: AsyncSession,
    archive_id: str,
    passages: list[dict],
    embeddings: list[list[float]],
) -> int:
    """Insert passages with embeddings into the database.

    Returns the number of passages inserted.
    """
    import json

    count = 0
    for passage, embedding in zip(passages, embeddings, strict=False):
        # Convert embedding list to PostgreSQL vector format
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

        await session.execute(
            text("""
                INSERT INTO archive_passages (archive_id, text, embedding, tags, metadata_, created_at, updated_at)
                VALUES (:archive_id, :text, :embedding, :tags, :metadata, NOW(), NOW())
            """),
            {
                "archive_id": archive_id,
                "text": passage["text"],
                "embedding": embedding_str,
                "tags": json.dumps(passage.get("tags")),
                "metadata": "{}",
            },
        )
        count += 1
        print(f"  Inserted: {passage['text'][:50]}...")

    await session.commit()
    return count


async def test_similarity_search(session: AsyncSession, query: str) -> None:
    """Test similarity search with a sample query."""
    print(f"\nTesting similarity search with query: '{query}'")

    # Create embedding for query
    query_embeddings = await create_embeddings([query])
    query_embedding = query_embeddings[0]
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

    # Search for similar passages
    result = await session.execute(
        text("""
            SELECT
                id,
                text,
                tags,
                1 - (embedding <=> :query_embedding) as similarity
            FROM archive_passages
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> :query_embedding
            LIMIT 5
        """),
        {"query_embedding": embedding_str},
    )

    rows = result.fetchall()
    print(f"\nTop {len(rows)} results:")
    for i, row in enumerate(rows, 1):
        print(f"  {i}. [score: {row.similarity:.4f}] {row.text[:80]}...")
        if row.tags:
            print(f"     Tags: {row.tags}")


async def main(archive_id: str):
    """Main function to populate embeddings."""
    print("=" * 60)
    print("Archive Embeddings Population Script")
    print("=" * 60)

    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY environment variable not set")
        print("Please set it with: export OPENAI_API_KEY=your-api-key")
        sys.exit(1)

    print(f"\nArchive ID: {archive_id}")
    print(f"Database: {DATABASE_URL.split('@')[-1]}")  # Hide credentials
    print(f"Embedding model: {EMBEDDING_MODEL}")
    print(f"Passages to embed: {len(SAMPLE_PASSAGES)}")

    # Create async engine and session
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Step 1: Ensure archive exists
        print("\n--- Step 1: Creating archive ---")
        archive_name = archive_id.replace("-", " ").title()
        archive_id = await ensure_archive_exists(session, archive_id=archive_id, name=archive_name)

        # Step 2: Create embeddings
        print("\n--- Step 2: Creating embeddings via OpenAI API ---")
        texts = [p["text"] for p in SAMPLE_PASSAGES]
        embeddings = await create_embeddings(texts)

        # Step 3: Insert passages
        print("\n--- Step 3: Inserting passages with embeddings ---")
        count = await insert_passages(session, archive_id, SAMPLE_PASSAGES, embeddings)
        print(f"\nInserted {count} passages")

        # Step 4: Test similarity search
        print("\n--- Step 4: Testing similarity search ---")
        await test_similarity_search(session, "What programming languages does the user know?")
        await test_similarity_search(session, "Tell me about the user's pets")
        await test_similarity_search(session, "What are the upcoming deadlines?")

    await engine.dispose()

    print("\n" + "=" * 60)
    print("Done! Archive populated with embeddings.")
    print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Populate archive embeddings database with sample passages",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "archive_id",
        help="Archive ID to populate (e.g., 'my-archive', 'test-archive')",
    )
    args = parser.parse_args()

    asyncio.run(main(args.archive_id))
