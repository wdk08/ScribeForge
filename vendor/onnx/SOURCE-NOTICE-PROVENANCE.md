# Additional ONNX dependency notices

Keep these notices with the original ONNX MIT license/ThirdPartyNotices.txt.
They supplement upstream archives; they do not relicense those dependencies.

- Boost mp11 headers at boost-1.82.0 state BSL-1.0 and reference the Boost license
  rather than containing it in that submodule archive. LICENSE-boost reproduces
  the full BSL-1.0 text already retained in ONNX's ThirdPartyNotices.txt.
- ONNX's pinned pthreadpool source commit
  4e80ca24521aa0fb3a746f9ea9c3eaa20e9afbb0 has BSD-style headers but lacks the root
  LICENSE. Upstream restored it in b4fb4eb1668c7d976cdaa941b135a02462adb460
  (January 10, 2025). LICENSE-pthreadpool is that unmodified BSD-2-Clause text.
  Its Git blob 27aa856e421b97959e3454523ce7108601f31677 is identical to the
  file before deletion d5b1640bcb22da95bbb7c21b13e18dfe83e40055. Original Google,
  Facebook and Georgia Tech copyrights remain. Sources retain their headers.
- Eigen source and hashes are in third-party/eigen-source.json. ONNX's
  adjust_global_compile_flags.cmake defines EIGEN_MPL2_ONLY. Optional non-MPL
  Eigen modules are not linked; the source archive retains their original terms.

Origins: https://github.com/google/pthreadpool and
https://github.com/boostorg/mp11 . No speech models are included in this source.
