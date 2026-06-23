CLIENT_SUPPORT = (
    "FastMCP client support is not installed. Install `fastmcp` or "
    "`shuvmcp[client]`."
)

SERVER_SUPPORT = (
    "FastMCP server support is not installed. Install `fastmcp` or "
    "`shuvmcp[server]`."
)

APP_SUPPORT = (
    "FastMCP app support is not installed. Install `fastmcp[apps]` or "
    "`shuvmcp[server,apps]`."
)

CLI_SUPPORT = (
    "FastMCP CLI support is not installed. Install `fastmcp` or `shuvmcp[server]`."
)


def full_package(feature: str) -> str:
    return (
        f"{feature} require the full `fastmcp` package. "
        "Install it with `pip install fastmcp`."
    )
