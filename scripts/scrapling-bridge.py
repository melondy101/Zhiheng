import json, sys, os

ROOT = r"D:\本机文件\Downloads\Scrapling-main\Scrapling-main"
if os.path.isdir(ROOT):
    sys.path.insert(0, ROOT)

def main():
    payload = json.loads(sys.stdin.read() or "{}")
    from scrapling.pipelines.zhihu import ZhihuPipeline, SQLitePostStore
    db = payload.get("storePath") or os.environ.get("SCRAPLING_STORE_PATH") or os.path.join(os.getcwd(), "data", "zhihu_posts.sqlite3")
    os.makedirs(os.path.dirname(db), exist_ok=True)
    pipeline = ZhihuPipeline(SQLitePostStore(db), search_timeout=int(payload.get("timeout", 20)))
    result = pipeline.think_with_official_api(str(payload.get("query", "")), hot_posts=[], limit=int(payload.get("limit", 10)))
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"posts": [], "post_count": 0, "report_input": "", "official_api": {"status": "fallback", "error": {"code": "SCRAPLING_ERROR", "message": str(exc)}}}, ensure_ascii=False))
