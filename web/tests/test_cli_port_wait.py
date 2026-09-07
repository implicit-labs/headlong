"""headlong-web waits for a port that is still being released instead of bailing."""
import socket
import threading
import time

from headlong_web.cli import _port_free, _wait_for_port


def test_wait_for_port_returns_once_previous_owner_releases():
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    holder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    holder.bind(("127.0.0.1", 0))
    holder.listen(1)
    port = holder.getsockname()[1]
    assert not _port_free("127.0.0.1", port)
    threading.Timer(0.8, holder.close).start()
    started = time.monotonic()
    assert _wait_for_port("127.0.0.1", port, timeout=5.0, poll=0.1) is True
    assert 0.5 < time.monotonic() - started < 4.0
    assert _port_free("127.0.0.1", port)


def test_wait_for_port_gives_up_when_the_port_stays_taken():
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    holder.bind(("127.0.0.1", 0)); holder.listen(1)
    try:
        assert _wait_for_port("127.0.0.1", holder.getsockname()[1], timeout=0.6, poll=0.1) is False
    finally:
        holder.close()
