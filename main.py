import importlib.util
import os
import sys

backend_dir = os.path.join(os.path.dirname(__file__), "backend")
sys.path.insert(0, backend_dir)

spec = importlib.util.spec_from_file_location(
    "holy_smokes_backend", os.path.join(backend_dir, "main.py")
)
backend = importlib.util.module_from_spec(spec)
sys.modules["holy_smokes_backend"] = backend
spec.loader.exec_module(backend)

app = backend.app
