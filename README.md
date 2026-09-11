# Legacy SQL Trace Profiler 1.0.5

Windows와 macOS의 VS Code에서 SQL Server Legacy SQL Trace를 실시간으로 확인하는 Extension입니다. Extended Events 권한 없이 `ALTER TRACE` 권한과 `sp_trace_*` 계열을 사용하며, 운영체제별 네이티브 실행 파일에 의존하지 않습니다.

## 버전 변경사항

### 1.0.5

- 대량 이벤트 배치 렌더링·가상 스크롤과 사용자 위치 기반 최신 이벤트 자동 추적
- 필터로 숨겨진 이벤트의 불필요한 목록 렌더링 생략
- 기본 컬럼을 유지하는 사용자 선택형 추가 Trace 컬럼
- Trace 생성 없는 연결·DB·버전·ALTER TRACE 권한 테스트
- 이벤트 목록 위 실행 제어 버튼·상태 배치와 전체 UI 확대
- 서버 프로필 변경 시 기존 수집 이벤트와 SQL 상세 초기화

### 1.0.4

- DatabaseName 이벤트 목록 컬럼과 화면 필터
- EventClass·TextData 대상 다중 제외 문자열 태그 필터
- 5분 단위·최대 30분의 서버 측 Trace 안전 만료
- 수동 종료·시간 만료·오류 종료 사유의 이벤트 목록 표시

### 1.0.2

- SQL 상세 영역 한정 `Ctrl/Cmd+A` 전체 선택 및 `Ctrl/Cmd+C` 복사
- 이벤트·서버·화면 필터를 묶은 필터 프로필과 전체 초기화
- 공용·개인 서버/필터 프로필의 분리 저장 및 공용 프로필 개인 사본 생성
- 개인 프로필 JSON의 Finder·Windows 탐색기 열기
- 실행 중 프로필 JSON 외부 변경 자동 반영

### 1.0.1

- Windows와 macOS 공통 실행·VSIX 패키징
- Activity Bar 프로파일러 진입점
- 일반 클릭 단건 선택 및 `Shift+클릭` 범위 선택
- 개발 중 자동 빌드와 Extension Development Host 갱신 방식

## V1 기능

- 여러 SQL Server 연결 프로필 저장, 선택, 수정, 삭제
- Trace를 생성하지 않는 연결·DB·버전·ALTER TRACE 권한 테스트
- 기본 DB 로그인 및 선택적인 Trace 전용 로그인
- 비밀번호를 포함한 프로필 JSON 가져오기·내보내기
- RPC, SQL Batch, SQL Statement, Stored Procedure 이벤트의 Starting·Completed 선택
- TextData, LoginName, DatabaseName, ApplicationName, HostName, SPID, Duration, Reads, Writes, CPU 서버 필터
- 이벤트·서버·화면 필터를 함께 저장하고 적용하는 필터 프로필
- 이벤트·서버·화면 필터 전체 초기화
- 시작, 정지, 재개, 종료 및 종료 후 결과 유지
- 기본 5분, 5분 단위·최대 30분 서버 측 안전 만료와 정상 실행 중 만료 시 Trace 자동 삭제
- 행 번호, EventClass, TextData, LoginName 실시간 목록
- 150ms 이벤트 묶음 갱신과 가상 스크롤 기반 대량 목록 렌더링
- 목록 하단에서는 최신 이벤트 자동 추적, 위로 스크롤하면 자동 추적 일시 해제
- 일반 클릭 단건 선택, Shift+클릭 범위 선택 및 선택된 SQL의 목록 순서 누적 표시·복사
- 캡처 후 TextData, EventClass, LoginName 화면 필터
- 목록 마지막 DatabaseName 컬럼과 DatabaseName 화면 필터
- 사용자별 선택 상태를 유지하는 추가 Trace 컬럼 표시
- EventClass·TextData에 적용되는 다중 제외 문자열 태그 필터
- SQL 전문, 간단한 구문 강조, 보기용 줄바꿈 정리, 원문 복사
- SQL 상세 영역 한정 Ctrl+A·Cmd+A 전체 선택 및 Ctrl+C·Cmd+C 복사
- VS Code 좌측 Activity Bar의 SQL Trace Profiler 보기

## 설치 및 실행

1. VS Code의 Extensions 화면에서 `...` → `Install from VSIX...`를 선택합니다.
2. `legacy-sql-trace-profiler-1.0.5.vsix`를 선택합니다.
3. 좌측 Activity Bar의 데이터베이스 아이콘을 누르고 `프로파일러 열기`를 선택합니다. 명령 팔레트의 `Legacy SQL Trace Profiler: Open Profiler`도 사용할 수 있습니다.
4. 연결 프로필을 저장하고 이벤트·필터를 선택한 뒤 시작합니다.

기본 계정에 `ALTER TRACE` 권한이 없다면 프로필에서 별도 Trace 전용 계정을 켭니다. 정지는 서버 Trace의 신규 수집을 멈추고, 시작을 다시 누르면 기존 결과를 유지한 채 재개합니다. 종료는 서버 Trace 자원을 제거하지만 화면의 결과는 유지합니다.

## 프로필 JSON

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "sample",
      "name": "DEV",
      "server": "sql.example.local",
      "port": 1433,
      "database": "SampleDb",
      "user": "app_user",
      "password": "plain-text-password",
      "useTraceCredentials": true,
      "traceUser": "trace_user",
      "tracePassword": "plain-text-trace-password",
      "encrypt": true,
      "trustServerCertificate": true
    }
  ]
}
```

사용자 요구사항에 따라 비밀번호는 JSON에 평문으로 저장되며 내보낸 파일에도 포함됩니다.

공용 서버 프로필은 프로젝트의 `data/server-profiles.json`, 공용 필터 프로필은 `data/filter-profiles.json`에 저장되어 VSIX에 함께 포함됩니다. 사용자가 추가하는 개인 서버·필터 프로필은 VS Code의 Extension 전역 저장 디렉터리에 각각 `server-profiles.json`, `filter-profiles.json`으로 저장되며, 파일이 없으면 빈 프로필 JSON으로 자동 생성됩니다. 각 콤보박스 최상단의 파일 열기 항목으로 개인 JSON을 Finder 또는 Windows 탐색기에서 바로 확인할 수 있으며, 실행 중 파일을 외부에서 수정해도 목록에 자동 반영됩니다. 공용 프로필은 읽기 전용이며 수정해 저장하면 개인 프로필 사본이 생성됩니다.

## VSIX 빌드 및 배포

Node.js 18 이상이 설치된 Windows 또는 macOS 터미널에서 다음 명령을 실행합니다.

```shell
npm install
npm test
npm run build
npm run package
```

완성된 `legacy-sql-trace-profiler-1.0.5.vsix`는 프로젝트의 `outputs` 폴더에 생성됩니다. 배포할 때 이 파일을 전달하고, 사용자는 VS Code의 Extensions 화면 우측 상단 `...` → `Install from VSIX...`에서 설치합니다. Marketplace 배포가 필요하면 publisher 등록 후 공식 `@vscode/vsce` 도구의 `vsce publish` 절차를 사용합니다.

## 개발 중 바로 확인

VSIX를 매번 만들 필요 없이 이 프로젝트를 VS Code로 열고 F5를 눌러 Extension Development Host를 실행합니다. 별도 터미널에서 `npm run watch`를 실행하면 소스 변경이 자동 빌드되며, 개발 호스트에서 Windows/Linux는 `Ctrl+R`, macOS는 `Cmd+R`로 다시 로드하면 최신 변경을 확인할 수 있습니다. `media`의 화면 파일을 변경한 경우에도 프로파일러 탭을 닫고 다시 열거나 개발 호스트를 다시 로드합니다.

## 플랫폼 참고

Extension 실행 코드는 VS Code가 지원하는 Windows와 macOS에서 동일하게 동작합니다. 다만 실제 연결 성공 여부는 SQL Server 네트워크 접근, 방화벽, TLS 인증서, SQL 로그인 및 `ALTER TRACE` 권한 설정의 영향을 받습니다.

## 현재 검증 범위

Trace 바이너리 디코딩과 이벤트 조립은 자동 테스트합니다. 실제 SQL Server 연결·권한·이벤트 수신은 대상 서버에서 확인해야 합니다. `sp_trace_getdata`는 SQL Server의 비공개 스트림 인터페이스이므로 서버 버전에 따른 호환성 확인이 필요합니다.
