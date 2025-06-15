# Legacy E-commerce Application

이 애플리케이션은 AWS 애플리케이션 현대화 워크샵을 위한 레거시 모놀리스 이커머스 시스템입니다. 이 애플리케이션은 모놀리스 아키텍처에서 마이크로서비스 아키텍처로의 현대화 실습을 위한 기반 코드로 사용됩니다.

## 애플리케이션 개요

이 이커머스 애플리케이션은 다음과 같은 레거시 특성을 가지고 있습니다:

- **모놀리식 아키텍처**: 모든 기능이 하나의 애플리케이션에 통합
- **파일 기반 데이터베이스**: SQLite를 사용한 로컬 파일 저장
- **단일 서버 배포**: 모든 컴포넌트가 하나의 서버에서 실행
- **직접 관리 필요**: 데이터베이스, 파일 저장소, 알림 시스템 등을 직접 관리

## 주요 기능

### 사용자 관리
- 사용자 회원가입 및 로그인
- 프로필 관리
- 주소록 관리
- 장바구니 기능

### 상품 관리
- 상품 카탈로그 조회
- 카테고리별 상품 분류
- 상품 검색 및 필터링
- 상품 이미지 관리

### 주문 관리
- 주문 생성 및 처리
- 주문 상태 추적
- 주문 내역 조회
- 주문 취소 기능

### 결제 시스템
- 다양한 결제 수단 지원
- 결제 처리 및 검증
- 환불 처리
- 결제 내역 관리

### 재고 관리
- 실시간 재고 추적
- 재고 부족 알림
- 재고 조정 기능
- 재고 이동 내역

### 알림 시스템
- 주문 상태 알림
- 재고 부족 알림
- 시스템 알림
- 사용자별 알림 관리

## 기술 스택

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: SQLite (파일 기반)
- **Authentication**: JWT
- **File Upload**: Multer
- **Security**: Helmet, CORS, Rate Limiting

### Frontend
- **HTML5/CSS3**: 반응형 웹 디자인
- **JavaScript**: Vanilla JavaScript (ES6+)
- **Icons**: Font Awesome
- **UI**: 커스텀 CSS 프레임워크

### 개발 도구
- **Testing**: Jest, Supertest
- **Development**: Nodemon
- **Security**: bcryptjs for password hashing

## 디렉토리 구조

```
/legacy-web-app
├── server.js              # 메인 애플리케이션 서버
├── package.json           # 의존성 및 스크립트 정의
├── config/
│   └── database.js        # 데이터베이스 설정 및 초기화
├── middleware/
│   └── auth.js            # 인증 미들웨어
├── models/                # 데이터 모델 (향후 확장용)
├── routes/                # API 라우트
│   ├── auth.js           # 인증 관련 API
│   ├── users.js          # 사용자 관리 API
│   ├── products.js       # 상품 관리 API
│   ├── orders.js         # 주문 관리 API
│   ├── payments.js       # 결제 처리 API
│   ├── inventory.js      # 재고 관리 API
│   └── notifications.js  # 알림 시스템 API
├── services/              # 비즈니스 로직 서비스
│   ├── auditService.js   # 감사 로그 서비스
│   ├── notificationService.js # 알림 서비스
│   ├── paymentService.js # 결제 처리 서비스
│   └── inventoryService.js # 재고 관리 서비스
├── public/                # 정적 파일
│   ├── index.html        # 메인 웹 페이지
│   ├── css/
│   │   └── style.css     # 스타일시트
│   ├── js/
│   │   └── app.js        # 프론트엔드 로직
│   └── images/           # 이미지 파일
├── uploads/               # 업로드된 파일 저장소
├── data/                  # SQLite 데이터베이스 파일
├── scripts/
│   └── init-database.js  # 데이터베이스 초기화 스크립트
└── tests/                 # 테스트 파일
```

## 설치 및 실행

### 사전 요구사항
- Node.js 18.0 이상
- npm 8.0 이상

### 설치 과정

1. **의존성 설치**
```bash
cd legacy-web-app
npm install
```

2. **데이터베이스 초기화**
```bash
npm run init-db
```

3. **애플리케이션 실행**
```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm start
```

4. **웹 브라우저에서 접속**
```
http://localhost:3000
```

### 기본 계정 정보
- **관리자**: admin / admin123
- **고객**: customer / customer123

## API 엔드포인트

### 인증 API
| 메서드 | 엔드포인트 | 설명 |
|--------|------------|------|
| POST | /api/auth/register | 사용자 회원가입 |
| POST | /api/auth/login | 사용자 로그인 |
| GET | /api/auth/profile | 사용자 프로필 조회 |
| PUT | /api/auth/profile | 사용자 프로필 수정 |

### 상품 API
| 메서드 | 엔드포인트 | 설명 |
|--------|------------|------|
| GET | /api/products | 상품 목록 조회 |
| GET | /api/products/:id | 특정 상품 조회 |
| POST | /api/products | 상품 생성 (관리자) |
| PUT | /api/products/:id | 상품 수정 (관리자) |
| DELETE | /api/products/:id | 상품 삭제 (관리자) |

### 주문 API
| 메서드 | 엔드포인트 | 설명 |
|--------|------------|------|
| GET | /api/orders | 주문 목록 조회 |
| GET | /api/orders/:id | 특정 주문 조회 |
| POST | /api/orders | 주문 생성 |
| PUT | /api/orders/:id/status | 주문 상태 변경 (관리자) |
| PUT | /api/orders/:id/cancel | 주문 취소 |

### 결제 API
| 메서드 | 엔드포인트 | 설명 |
|--------|------------|------|
| POST | /api/payments/process | 결제 처리 |
| GET | /api/payments/history | 결제 내역 조회 |
| POST | /api/payments/:id/refund | 환불 처리 (관리자) |

### 사용자 API
| 메서드 | 엔드포인트 | 설명 |
|--------|------------|------|
| GET | /api/users/:id/cart | 장바구니 조회 |
| POST | /api/users/:id/cart | 장바구니에 상품 추가 |
| PUT | /api/users/:id/cart/:itemId | 장바구니 상품 수량 변경 |
| DELETE | /api/users/:id/cart/:itemId | 장바구니에서 상품 제거 |

## 현대화 대상 영역

이 애플리케이션은 다음과 같은 현대화 실습을 위해 설계되었습니다:

### 1. 마이크로서비스 아키텍처 분리 (MSA)
- **사용자 서비스**: 인증, 프로필 관리
- **상품 서비스**: 상품 카탈로그, 검색
- **주문 서비스**: 주문 처리, 상태 관리
- **결제 서비스**: 결제 처리, 환불
- **재고 서비스**: 재고 관리, 추적
- **알림 서비스**: 알림 발송, 관리

### 2. 데이터베이스 현대화
- **현재**: SQLite (파일 기반)
- **목표**: Amazon RDS, DynamoDB 등 완전관리형 데이터베이스
- **이점**: 확장성, 가용성, 백업/복구 자동화

### 3. 서버리스 함수 분리
- **알림 처리**: Lambda 함수로 분리
- **이미지 처리**: Lambda 함수로 분리
- **배치 작업**: Lambda 함수로 분리
- **이벤트 처리**: EventBridge, SQS 연동

### 4. 컨테이너화 및 오케스트레이션
- **컨테이너화**: Docker를 사용한 애플리케이션 패키징
- **오케스트레이션**: Amazon ECS를 사용한 컨테이너 관리
- **로드 밸런싱**: Application Load Balancer 구성
- **오토 스케일링**: 트래픽에 따른 자동 확장

### 5. 클라우드 네이티브 서비스 활용
- **파일 저장소**: Amazon S3
- **CDN**: Amazon CloudFront
- **모니터링**: Amazon CloudWatch
- **로깅**: AWS CloudTrail
- **보안**: AWS IAM, AWS Secrets Manager

## 테스트

```bash
# 단위 테스트 실행
npm test

# 테스트 커버리지 확인
npm run test:coverage
```

## 개발 가이드

### 코드 스타일
- ES6+ 문법 사용
- async/await 패턴 사용
- 에러 핸들링 필수
- 로깅 및 모니터링 고려

### 보안 고려사항
- JWT 토큰 기반 인증
- 비밀번호 해싱 (bcrypt)
- SQL 인젝션 방지
- XSS 방지
- CSRF 방지

### 성능 최적화
- 데이터베이스 인덱싱
- 이미지 최적화
- 캐싱 전략
- 페이지네이션

## 문제 해결

### 일반적인 문제들

1. **데이터베이스 연결 오류**
   - `data` 디렉토리 권한 확인
   - SQLite 파일 생성 권한 확인

2. **포트 충돌**
   - 환경변수 `PORT` 설정
   - 다른 애플리케이션과의 포트 충돌 확인

3. **파일 업로드 오류**
   - `uploads` 디렉토리 권한 확인
   - 디스크 공간 확인

## 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.

## 기여하기

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 지원

문제가 발생하거나 질문이 있으시면 GitHub Issues를 통해 문의해 주세요.

---

**참고**: 이 애플리케이션은 교육 목적으로 제작되었으며, 프로덕션 환경에서 사용하기 전에 추가적인 보안 검토와 성능 최적화가 필요합니다.
